import {
  DEFAULT_RESEARCH_PROJECTS_PER_OWNER,
  MAX_RESEARCH_TITLE_LENGTH,
  auditResearch,
} from 'coderax-data-provider';
import type { Model, SortOrder } from 'mongoose';
import type {
  IResearchClaim,
  IResearchProject,
  IResearchProjectDocument,
  IResearchProjectQuotaDocument,
  IResearchSource,
} from '~/types';
import { isValidObjectIdString } from '~/utils/objectId';
import { escapeRegExp } from '~/utils/string';
import logger from '~/config/winston';

export type CreateResearchProjectInput = {
  title: string;
  question?: string;
};

export type SaveResearchProjectInput = {
  title: string;
  question: string;
  status: IResearchProject['status'];
  sources: IResearchSource[];
  claims: IResearchClaim[];
};

export type ListResearchProjectsOptions = {
  cursor?: string | null;
  limit?: number;
  search?: string;
};

export type ListResearchProjectsResult = {
  projects: IResearchProject[];
  nextCursor: string | null;
};

export type CreateResearchProjectResult =
  | { ok: true; project: IResearchProject }
  | { ok: false; code: 'LIMIT_REACHED' };

export type SaveResearchProjectResult =
  | { ok: true; project: IResearchProject }
  | { ok: false; code: 'NOT_FOUND' }
  | { ok: false; code: 'NOT_READY' }
  | { ok: false; code: 'READ_ONLY'; project: IResearchProject }
  | { ok: false; code: 'CONFLICT'; project: IResearchProject };

export type ResearchProjectLimits = {
  maxProjectsPerOwner?: number;
};

export interface ResearchProjectMethods {
  createResearchProject(
    user: string,
    input: CreateResearchProjectInput,
    limits?: ResearchProjectLimits,
  ): Promise<CreateResearchProjectResult>;
  getResearchProject(user: string, researchId: string): Promise<IResearchProject | null>;
  listResearchProjects(
    user: string,
    options?: ListResearchProjectsOptions,
  ): Promise<ListResearchProjectsResult>;
  saveResearchProject(
    user: string,
    researchId: string,
    input: SaveResearchProjectInput,
    expectedRevision: number,
  ): Promise<SaveResearchProjectResult>;
  deleteResearchProject(user: string, researchId: string): Promise<boolean>;
}

type ResearchProjectCursor = { createdAt: string; id: string };
type ResearchProjectLean = IResearchProject & { _id: NonNullable<IResearchProject['_id']> };

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;

function normalizeLimit(limit?: number): number {
  if (!Number.isFinite(limit) || !limit) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.max(Math.floor(limit as number), 1), MAX_PAGE_SIZE);
}

function sanitizeTitle(title: unknown): string {
  if (typeof title !== 'string') {
    throw new Error('Research title is required');
  }
  const trimmed = title.trim().slice(0, MAX_RESEARCH_TITLE_LENGTH);
  if (!trimmed) {
    throw new Error('Research title is required');
  }
  return trimmed;
}

function parseCursor(cursor?: string | null): ResearchProjectCursor | null {
  if (!cursor) {
    return null;
  }
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString()) as ResearchProjectCursor;
    const createdAt = new Date(decoded.createdAt);
    if (!decoded.id || !isValidObjectIdString(decoded.id) || Number.isNaN(createdAt.getTime())) {
      return null;
    }
    return { createdAt: createdAt.toISOString(), id: decoded.id };
  } catch {
    logger.warn('[listResearchProjects] Invalid cursor format, starting from beginning');
    return null;
  }
}

const isDuplicateKeyError = (error: unknown): boolean =>
  (error as { code?: number } | null)?.code === 11000;

function encodeCursor(project: ResearchProjectLean): string | null {
  if (!project.createdAt) {
    return null;
  }
  return Buffer.from(
    JSON.stringify({ createdAt: project.createdAt.toISOString(), id: project._id.toString() }),
  ).toString('base64');
}

export function createResearchProjectMethods(
  mongoose: typeof import('mongoose'),
): ResearchProjectMethods {
  async function getResearchProject(
    user: string,
    researchId: string,
  ): Promise<IResearchProject | null> {
    if (!isValidObjectIdString(researchId)) {
      return null;
    }
    const ResearchProject = mongoose.models.ResearchProject as Model<IResearchProjectDocument>;
    return await ResearchProject.findOne({
      _id: new mongoose.Types.ObjectId(researchId),
      user,
    }).lean<IResearchProject>();
  }

  /**
   * Reserves one owner slot with a conditional increment, so concurrent creates
   * cannot both read the same count and exceed the limit. The first reservation
   * seeds the counter from the projects that already exist.
   */
  async function reserveProjectSlot(user: string, maxProjects: number): Promise<boolean> {
    const ResearchProjectQuota = mongoose.models
      .ResearchProjectQuota as Model<IResearchProjectQuotaDocument>;
    const ResearchProject = mongoose.models.ResearchProject as Model<IResearchProjectDocument>;

    const reserved = await ResearchProjectQuota.findOneAndUpdate(
      { user, count: { $lt: maxProjects } },
      { $inc: { count: 1 } },
      { new: true },
    ).lean();
    if (reserved) {
      return true;
    }

    if (await ResearchProjectQuota.exists({ user })) {
      return false;
    }

    const existing = await ResearchProject.countDocuments({ user });
    if (existing >= maxProjects) {
      return false;
    }

    try {
      await ResearchProjectQuota.create({ user, count: existing + 1 });
      return true;
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
      /* Another first create seeded the counter; retry against the seeded value. */
      const retried = await ResearchProjectQuota.findOneAndUpdate(
        { user, count: { $lt: maxProjects } },
        { $inc: { count: 1 } },
        { new: true },
      ).lean();
      return Boolean(retried);
    }
  }

  async function releaseProjectSlot(user: string): Promise<void> {
    const ResearchProjectQuota = mongoose.models
      .ResearchProjectQuota as Model<IResearchProjectQuotaDocument>;
    await ResearchProjectQuota.updateOne({ user, count: { $gt: 0 } }, { $inc: { count: -1 } });
  }

  async function createResearchProject(
    user: string,
    input: CreateResearchProjectInput,
    limits?: ResearchProjectLimits,
  ): Promise<CreateResearchProjectResult> {
    const ResearchProject = mongoose.models.ResearchProject as Model<IResearchProjectDocument>;
    const maxProjects = limits?.maxProjectsPerOwner ?? DEFAULT_RESEARCH_PROJECTS_PER_OWNER;
    const title = sanitizeTitle(input.title);
    const question = typeof input.question === 'string' ? input.question.trim() : '';

    if (!(await reserveProjectSlot(user, maxProjects))) {
      return { ok: false, code: 'LIMIT_REACHED' };
    }

    try {
      const project = await ResearchProject.create({
        title,
        question,
        status: 'draft',
        revision: 1,
        sources: [],
        claims: [],
        user,
      });
      return { ok: true, project: project.toObject() as IResearchProject };
    } catch (error) {
      await releaseProjectSlot(user);
      throw error;
    }
  }

  async function listResearchProjects(
    user: string,
    options: ListResearchProjectsOptions = {},
  ): Promise<ListResearchProjectsResult> {
    const ResearchProject = mongoose.models.ResearchProject as Model<IResearchProjectDocument>;
    const limit = normalizeLimit(options.limit);
    const sortOrder: SortOrder = -1;
    const filter: Record<string, unknown> = { user };

    if (options.search?.trim()) {
      const searchRegex = { $regex: escapeRegExp(options.search.trim()), $options: 'i' };
      filter.$or = [{ title: searchRegex }, { question: searchRegex }];
    }

    const cursor = parseCursor(options.cursor);
    if (cursor) {
      const createdAt = new Date(cursor.createdAt);
      filter.$and = [
        {
          $or: [
            { createdAt: { $lt: createdAt } },
            { createdAt, _id: { $lt: new mongoose.Types.ObjectId(cursor.id) } },
          ],
        },
      ];
    }

    const projects = await ResearchProject.find(filter)
      .sort({ createdAt: sortOrder, _id: sortOrder })
      .limit(limit + 1)
      .lean<ResearchProjectLean[]>();

    let nextCursor: string | null = null;
    if (projects.length > limit) {
      projects.pop();
      const lastProject = projects[projects.length - 1];
      if (lastProject) {
        nextCursor = encodeCursor(lastProject);
      }
    }
    return { projects, nextCursor };
  }

  async function saveResearchProject(
    user: string,
    researchId: string,
    input: SaveResearchProjectInput,
    expectedRevision: number,
  ): Promise<SaveResearchProjectResult> {
    if (!isValidObjectIdString(researchId)) {
      return { ok: false, code: 'NOT_FOUND' };
    }
    /* `complete` is a claim about the ledger, so the persistence boundary
       re-derives it instead of trusting the request. */
    if (input.status === 'complete' && !auditResearch(input).ready) {
      return { ok: false, code: 'NOT_READY' };
    }

    const ResearchProject = mongoose.models.ResearchProject as Model<IResearchProjectDocument>;
    const filter: Record<string, unknown> = {
      _id: new mongoose.Types.ObjectId(researchId),
      user,
      revision: expectedRevision,
    };
    /* A completed dossier is read-only; reopening it (any other status) still matches. */
    if (input.status === 'complete') {
      filter.status = { $ne: 'complete' };
    }

    const project = await ResearchProject.findOneAndUpdate(
      filter,
      {
        $set: {
          title: sanitizeTitle(input.title),
          question: input.question,
          status: input.status,
          sources: input.sources,
          claims: input.claims,
        },
        $inc: { revision: 1 },
      },
      { new: true, runValidators: true },
    ).lean<IResearchProject>();
    if (project) {
      return { ok: true, project };
    }

    const current = await getResearchProject(user, researchId);
    if (!current) {
      return { ok: false, code: 'NOT_FOUND' };
    }
    if (
      input.status === 'complete' &&
      current.status === 'complete' &&
      current.revision === expectedRevision
    ) {
      return { ok: false, code: 'READ_ONLY', project: current };
    }
    return { ok: false, code: 'CONFLICT', project: current };
  }

  async function deleteResearchProject(user: string, researchId: string): Promise<boolean> {
    if (!isValidObjectIdString(researchId)) {
      return false;
    }
    const ResearchProject = mongoose.models.ResearchProject as Model<IResearchProjectDocument>;
    const result = await ResearchProject.deleteOne({
      _id: new mongoose.Types.ObjectId(researchId),
      user,
    });
    if ((result.deletedCount ?? 0) > 0) {
      await releaseProjectSlot(user);
      return true;
    }
    return false;
  }

  return {
    createResearchProject,
    getResearchProject,
    listResearchProjects,
    saveResearchProject,
    deleteResearchProject,
  };
}
