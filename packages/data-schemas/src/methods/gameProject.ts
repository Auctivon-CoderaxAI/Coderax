import {
  DEFAULT_GAME_PROJECTS_PER_OWNER,
  MAX_GAME_NAME_LENGTH,
  MAX_GAME_SUMMARY_LENGTH,
} from 'coderax-data-provider';
import type { Model, SortOrder } from 'mongoose';
import type { IGameProject, IGameProjectDocument, IGameSpec } from '~/types';
import { isValidObjectIdString } from '~/utils/objectId';
import { escapeRegExp } from '~/utils/string';
import logger from '~/config/winston';

export type CreateGameProjectInput = {
  name: string;
  summary?: string;
  spec?: IGameSpec | null;
};

export type UpdateGameProjectInput = {
  name?: string;
  summary?: string;
};

export type ListGameProjectsOptions = {
  cursor?: string | null;
  limit?: number;
  search?: string;
};

export type ListGameProjectsResult = {
  projects: IGameProject[];
  nextCursor: string | null;
};

export type SaveGameSpecResult =
  | { ok: true; project: IGameProject }
  | { ok: false; code: 'NOT_FOUND' }
  | { ok: false; code: 'CONFLICT'; project: IGameProject };

export type CreateGameProjectResult =
  | { ok: true; project: IGameProject }
  | { ok: false; code: 'LIMIT_REACHED' };

export type GameProjectLimits = {
  maxProjectsPerOwner?: number;
};

export interface GameProjectMethods {
  createGameProject(
    user: string,
    input: CreateGameProjectInput,
    limits?: GameProjectLimits,
  ): Promise<CreateGameProjectResult>;
  getGameProject(user: string, gameId: string): Promise<IGameProject | null>;
  listGameProjects(
    user: string,
    options?: ListGameProjectsOptions,
  ): Promise<ListGameProjectsResult>;
  updateGameProject(
    user: string,
    gameId: string,
    input: UpdateGameProjectInput,
  ): Promise<IGameProject | null>;
  saveGameSpec(
    user: string,
    gameId: string,
    spec: IGameSpec,
    expectedRevision: number,
  ): Promise<SaveGameSpecResult>;
  deleteGameProject(user: string, gameId: string): Promise<boolean>;
}

type GameProjectCursor = { createdAt: string; id: string };
type GameProjectLean = IGameProject & { _id: NonNullable<IGameProject['_id']> };

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;

function normalizeLimit(limit?: number): number {
  if (!Number.isFinite(limit) || !limit) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.max(Math.floor(limit as number), 1), MAX_PAGE_SIZE);
}

function sanitizeName(name: unknown): string {
  if (typeof name !== 'string') {
    throw new Error('Game name is required');
  }
  const trimmed = name.trim().slice(0, MAX_GAME_NAME_LENGTH);
  if (!trimmed) {
    throw new Error('Game name is required');
  }
  return trimmed;
}

function sanitizeSummary(summary: unknown): string {
  if (summary === undefined || summary === null) {
    return '';
  }
  if (typeof summary !== 'string') {
    throw new Error('Invalid game summary');
  }
  return summary.trim().slice(0, MAX_GAME_SUMMARY_LENGTH);
}

function parseCursor(cursor?: string | null): GameProjectCursor | null {
  if (!cursor) {
    return null;
  }
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString()) as GameProjectCursor;
    const createdAt = new Date(decoded.createdAt);
    if (!decoded.id || !isValidObjectIdString(decoded.id) || Number.isNaN(createdAt.getTime())) {
      return null;
    }
    return { createdAt: createdAt.toISOString(), id: decoded.id };
  } catch {
    logger.warn('[listGameProjects] Invalid cursor format, starting from beginning');
    return null;
  }
}

function encodeCursor(project: GameProjectLean): string | null {
  if (!project.createdAt) {
    return null;
  }
  return Buffer.from(
    JSON.stringify({ createdAt: project.createdAt.toISOString(), id: project._id.toString() }),
  ).toString('base64');
}

export function createGameProjectMethods(mongoose: typeof import('mongoose')): GameProjectMethods {
  async function getGameProject(user: string, gameId: string): Promise<IGameProject | null> {
    if (!isValidObjectIdString(gameId)) {
      return null;
    }
    const GameProject = mongoose.models.GameProject as Model<IGameProjectDocument>;
    return await GameProject.findOne({
      _id: new mongoose.Types.ObjectId(gameId),
      user,
    }).lean<IGameProject>();
  }

  async function createGameProject(
    user: string,
    input: CreateGameProjectInput,
    limits?: GameProjectLimits,
  ): Promise<CreateGameProjectResult> {
    const GameProject = mongoose.models.GameProject as Model<IGameProjectDocument>;
    const maxProjects = limits?.maxProjectsPerOwner ?? DEFAULT_GAME_PROJECTS_PER_OWNER;
    const existing = await GameProject.countDocuments({ user });
    if (existing >= maxProjects) {
      return { ok: false, code: 'LIMIT_REACHED' };
    }

    const project = await GameProject.create({
      name: sanitizeName(input.name),
      summary: sanitizeSummary(input.summary),
      spec: input.spec ?? null,
      status: input.spec ? 'spec_ready' : 'draft',
      revision: 1,
      specRevision: input.spec ? 1 : 0,
      user,
    });
    return { ok: true, project: project.toObject() as IGameProject };
  }

  async function listGameProjects(
    user: string,
    options: ListGameProjectsOptions = {},
  ): Promise<ListGameProjectsResult> {
    const GameProject = mongoose.models.GameProject as Model<IGameProjectDocument>;
    const limit = normalizeLimit(options.limit);
    const sortOrder: SortOrder = -1;
    const filter: Record<string, unknown> = { user };

    if (options.search?.trim()) {
      const searchRegex = { $regex: escapeRegExp(options.search.trim()), $options: 'i' };
      filter.$or = [{ name: searchRegex }, { summary: searchRegex }];
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

    const projects = await GameProject.find(filter)
      .sort({ createdAt: sortOrder, _id: sortOrder })
      .limit(limit + 1)
      .lean<GameProjectLean[]>();

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

  async function updateGameProject(
    user: string,
    gameId: string,
    input: UpdateGameProjectInput,
  ): Promise<IGameProject | null> {
    if (!isValidObjectIdString(gameId)) {
      return null;
    }
    const GameProject = mongoose.models.GameProject as Model<IGameProjectDocument>;
    const update: Record<string, string> = {};
    if (input.name !== undefined) {
      update.name = sanitizeName(input.name);
    }
    if (input.summary !== undefined) {
      update.summary = sanitizeSummary(input.summary);
    }
    if (Object.keys(update).length === 0) {
      return await getGameProject(user, gameId);
    }

    const project = await GameProject.findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId(gameId), user },
      { $set: update, $inc: { revision: 1 } },
      { new: true, runValidators: true },
    ).lean<IGameProject>();
    return project ?? null;
  }

  async function saveGameSpec(
    user: string,
    gameId: string,
    spec: IGameSpec,
    expectedRevision: number,
  ): Promise<SaveGameSpecResult> {
    if (!isValidObjectIdString(gameId)) {
      return { ok: false, code: 'NOT_FOUND' };
    }
    const GameProject = mongoose.models.GameProject as Model<IGameProjectDocument>;
    const project = await GameProject.findOneAndUpdate(
      {
        _id: new mongoose.Types.ObjectId(gameId),
        user,
        revision: expectedRevision,
      },
      {
        $set: { spec, status: 'spec_ready' },
        $inc: { revision: 1, specRevision: 1 },
      },
      { new: true, runValidators: true },
    ).lean<IGameProject>();
    if (project) {
      return { ok: true, project };
    }

    const current = await getGameProject(user, gameId);
    if (!current) {
      return { ok: false, code: 'NOT_FOUND' };
    }
    return { ok: false, code: 'CONFLICT', project: current };
  }

  async function deleteGameProject(user: string, gameId: string): Promise<boolean> {
    if (!isValidObjectIdString(gameId)) {
      return false;
    }
    const GameProject = mongoose.models.GameProject as Model<IGameProjectDocument>;
    const result = await GameProject.deleteOne({
      _id: new mongoose.Types.ObjectId(gameId),
      user,
    });
    return (result.deletedCount ?? 0) > 0;
  }

  return {
    createGameProject,
    getGameProject,
    listGameProjects,
    updateGameProject,
    saveGameSpec,
    deleteGameProject,
  };
}
