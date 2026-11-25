import { logger, isValidObjectIdString } from '@coderax/data-schemas';
import {
  MAX_RESEARCH_CLAIM_LENGTH,
  MAX_RESEARCH_CLAIMS,
  MAX_RESEARCH_EXCERPT_LENGTH,
  MAX_RESEARCH_NOTE_LENGTH,
  MAX_RESEARCH_PUBLISHER_LENGTH,
  MAX_RESEARCH_QUESTION_LENGTH,
  MAX_RESEARCH_SOURCES,
  MAX_RESEARCH_SOURCES_PER_CLAIM,
  MAX_RESEARCH_SOURCE_TITLE_LENGTH,
  MAX_RESEARCH_SOURCE_URL_LENGTH,
  MAX_RESEARCH_TITLE_LENGTH,
  RESEARCH_CAPABILITIES,
  RESEARCH_CLAIM_STATUSES,
  RESEARCH_PROJECT_STATUSES,
  RESEARCH_SOURCE_ID_PATTERN,
  RESEARCH_SOURCE_KINDS,
  SystemRoles,
  auditResearch,
  researchUrlHost,
} from 'coderax-data-provider';
import type {
  CreateResearchProjectInput,
  ListResearchProjectsOptions,
  ResearchProjectMethods,
  SaveResearchProjectInput,
} from '@coderax/data-schemas';
import type {
  TResearchClaim,
  TResearchConfig,
  TResearchProjectStatus,
  TResearchSource,
} from 'coderax-data-provider';
import type { Request, Response } from 'express';
import { normalizeLimit, queryString } from '~/utils';

const RESEARCH_NOT_FOUND = { error: 'Research dossier not found', code: 'RESEARCH_NOT_FOUND' };
const RESEARCH_DISABLED = { error: 'Research is disabled', code: 'RESEARCH_DISABLED' };
const RESEARCH_OWNER_ONLY = { error: 'Research is owner-only', code: 'RESEARCH_OWNER_ONLY' };
const RESEARCH_LIMIT_REACHED = {
  error: 'Research dossier limit reached',
  code: 'RESEARCH_PROJECT_LIMIT_REACHED',
};
const RESEARCH_REVISION_CONFLICT = {
  error: 'Research dossier was changed by another session',
  code: 'RESEARCH_REVISION_CONFLICT',
};

interface ResearchUser {
  id?: string;
  role?: string;
  tenantId?: string;
  _id?: { toString(): string };
}

interface ResearchRequest extends Request {
  user?: ResearchUser;
  config?: { research?: TResearchConfig };
}

type ResearchHandlerDependencies = Pick<
  ResearchProjectMethods,
  | 'listResearchProjects'
  | 'createResearchProject'
  | 'getResearchProject'
  | 'saveResearchProject'
  | 'deleteResearchProject'
>;

const getUserId = (req: ResearchRequest): string => req.user?.id ?? req.user?._id?.toString() ?? '';

const isOwner = (req: ResearchRequest): boolean =>
  req.config?.research?.ownerOnly === false || req.user?.role === SystemRoles.ADMIN;

const requireOwner = (req: ResearchRequest, res: Response): Response | null => {
  if (req.config?.research?.enabled === false) {
    return res.status(403).json(RESEARCH_DISABLED);
  }
  if (!isOwner(req)) {
    return res.status(403).json(RESEARCH_OWNER_ONLY);
  }
  return null;
};

const boundedText = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.length <= max ? value.trim() : null;

const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (values as readonly string[]).includes(value);

const parseSources = (
  value: unknown,
  maxSources: number,
): { sources: TResearchSource[] } | { error: string } => {
  if (!Array.isArray(value)) {
    return { error: 'sources must be an array' };
  }
  if (value.length > maxSources) {
    return { error: `sources cannot exceed ${maxSources} entries` };
  }
  const sources: TResearchSource[] = [];
  const ids = new Set<string>();
  for (const [index, entry] of value.entries()) {
    if (!entry || typeof entry !== 'object') {
      return { error: `sources[${index}] must be an object` };
    }
    const source = entry as Record<string, unknown>;
    const id = boundedText(source.id, 64);
    if (!id || !RESEARCH_SOURCE_ID_PATTERN.test(id)) {
      return { error: `sources[${index}].id is invalid` };
    }
    if (ids.has(id)) {
      return { error: `sources[${index}].id is duplicated` };
    }
    ids.add(id);
    const title = boundedText(source.title, MAX_RESEARCH_SOURCE_TITLE_LENGTH);
    if (!title) {
      return { error: `sources[${index}].title is required` };
    }
    const url = boundedText(source.url, MAX_RESEARCH_SOURCE_URL_LENGTH);
    if (!url || !researchUrlHost(url)) {
      return { error: `sources[${index}].url must be an http(s) URL` };
    }
    if (!isOneOf(RESEARCH_SOURCE_KINDS, source.kind)) {
      return { error: `sources[${index}].kind is not a known source kind` };
    }
    const publisher = boundedText(source.publisher ?? '', MAX_RESEARCH_PUBLISHER_LENGTH);
    const excerpt = boundedText(source.excerpt ?? '', MAX_RESEARCH_EXCERPT_LENGTH);
    const note = boundedText(source.note ?? '', MAX_RESEARCH_NOTE_LENGTH);
    const retrievedAt = boundedText(source.retrievedAt ?? '', 40);
    if (publisher == null || excerpt == null || note == null || retrievedAt == null) {
      return { error: `sources[${index}] has a field over its maximum length` };
    }
    sources.push({ id, title, url, publisher, kind: source.kind, excerpt, note, retrievedAt });
  }
  return { sources };
};

const parseClaims = (
  value: unknown,
  maxClaims: number,
  knownSourceIds: ReadonlySet<string>,
): { claims: TResearchClaim[] } | { error: string } => {
  if (!Array.isArray(value)) {
    return { error: 'claims must be an array' };
  }
  if (value.length > maxClaims) {
    return { error: `claims cannot exceed ${maxClaims} entries` };
  }
  const claims: TResearchClaim[] = [];
  const ids = new Set<string>();
  for (const [index, entry] of value.entries()) {
    if (!entry || typeof entry !== 'object') {
      return { error: `claims[${index}] must be an object` };
    }
    const claim = entry as Record<string, unknown>;
    const id = boundedText(claim.id, 64);
    if (!id || !RESEARCH_SOURCE_ID_PATTERN.test(id)) {
      return { error: `claims[${index}].id is invalid` };
    }
    if (ids.has(id)) {
      return { error: `claims[${index}].id is duplicated` };
    }
    ids.add(id);
    const text = boundedText(claim.text, MAX_RESEARCH_CLAIM_LENGTH);
    if (!text) {
      return { error: `claims[${index}].text is required` };
    }
    if (!isOneOf(RESEARCH_CLAIM_STATUSES, claim.status)) {
      return { error: `claims[${index}].status is not a known claim status` };
    }
    if (
      !Array.isArray(claim.sourceIds) ||
      claim.sourceIds.length > MAX_RESEARCH_SOURCES_PER_CLAIM
    ) {
      return {
        error: `claims[${index}].sourceIds must be an array of at most ${MAX_RESEARCH_SOURCES_PER_CLAIM} citations`,
      };
    }
    const sourceIds = [
      ...new Set(
        claim.sourceIds.map((sourceId) => (typeof sourceId === 'string' ? sourceId.trim() : '')),
      ),
    ];
    if (sourceIds.some((sourceId) => !sourceId || !knownSourceIds.has(sourceId))) {
      return { error: `claims[${index}] cites a source that is not in this dossier` };
    }
    claims.push({ id, text, status: claim.status, sourceIds });
  }
  return { claims };
};

const parseDossier = (
  body: Record<string, unknown> | undefined,
  config?: TResearchConfig,
): { input: SaveResearchProjectInput } | { error: string } => {
  const raw = body ?? {};
  const title = boundedText(raw.title, MAX_RESEARCH_TITLE_LENGTH);
  if (!title) {
    return { error: 'title is required' };
  }
  const maxQuestion = config?.maxQuestionLength ?? MAX_RESEARCH_QUESTION_LENGTH;
  const question = boundedText(
    raw.question ?? '',
    Math.min(maxQuestion, MAX_RESEARCH_QUESTION_LENGTH),
  );
  if (question == null) {
    return { error: `question cannot exceed ${maxQuestion} characters` };
  }
  if (!isOneOf(RESEARCH_PROJECT_STATUSES, raw.status)) {
    return { error: 'status is not a known dossier status' };
  }
  const parsedSources = parseSources(raw.sources, config?.maxSources ?? MAX_RESEARCH_SOURCES);
  if ('error' in parsedSources) {
    return parsedSources;
  }
  const knownSourceIds = new Set(parsedSources.sources.map((source) => source.id));
  const parsedClaims = parseClaims(
    raw.claims,
    config?.maxClaims ?? MAX_RESEARCH_CLAIMS,
    knownSourceIds,
  );
  if ('error' in parsedClaims) {
    return parsedClaims;
  }
  return {
    input: {
      title,
      question,
      status: raw.status,
      sources: parsedSources.sources,
      claims: parsedClaims.claims,
    },
  };
};

const withAudit = (project: {
  title: string;
  question: string;
  status: TResearchProjectStatus;
  sources: TResearchSource[];
  claims: TResearchClaim[];
}) => ({
  ...project,
  audit: auditResearch({ sources: project.sources, claims: project.claims }),
});

export function createResearchHandlers(deps: ResearchHandlerDependencies): {
  getCapabilities: (req: ResearchRequest, res: Response) => Response;
  listProjects: (req: ResearchRequest, res: Response) => Promise<Response>;
  createProject: (req: ResearchRequest, res: Response) => Promise<Response>;
  getProject: (req: ResearchRequest, res: Response) => Promise<Response>;
  saveProject: (req: ResearchRequest, res: Response) => Promise<Response>;
  deleteProject: (req: ResearchRequest, res: Response) => Promise<Response>;
} {
  function getCapabilities(req: ResearchRequest, res: Response): Response {
    const denied = requireOwner(req, res);
    if (denied) {
      return denied;
    }
    return res.status(200).json(RESEARCH_CAPABILITIES);
  }

  async function listProjects(req: ResearchRequest, res: Response): Promise<Response> {
    const denied = requireOwner(req, res);
    if (denied) {
      return denied;
    }
    const options: ListResearchProjectsOptions = {
      cursor: queryString(req.query.cursor),
      limit: normalizeLimit(req.query.limit),
      search: queryString(req.query.search),
    };
    try {
      const result = await deps.listResearchProjects(getUserId(req), options);
      return res.status(200).json({
        projects: result.projects.map((project) =>
          withAudit({
            ...project,
            sources: project.sources ?? [],
            claims: project.claims ?? [],
          }),
        ),
        nextCursor: result.nextCursor,
      });
    } catch (error) {
      logger.error('[research] Error listing research dossiers', error);
      return res.status(500).json({ error: 'Error listing research dossiers' });
    }
  }

  async function createProject(req: ResearchRequest, res: Response): Promise<Response> {
    const denied = requireOwner(req, res);
    if (denied) {
      return denied;
    }
    const title = boundedText(req.body?.title, MAX_RESEARCH_TITLE_LENGTH);
    if (!title) {
      return res.status(400).json({ error: 'title is required' });
    }
    const maxQuestion = Math.min(
      req.config?.research?.maxQuestionLength ?? MAX_RESEARCH_QUESTION_LENGTH,
      MAX_RESEARCH_QUESTION_LENGTH,
    );
    const question = boundedText(req.body?.question ?? '', maxQuestion);
    if (question == null) {
      return res.status(400).json({ error: `question cannot exceed ${maxQuestion} characters` });
    }

    const input: CreateResearchProjectInput = { title, question };
    try {
      const result = await deps.createResearchProject(getUserId(req), input, {
        maxProjectsPerOwner: req.config?.research?.maxProjectsPerOwner,
      });
      if (!result.ok) {
        return res.status(409).json(RESEARCH_LIMIT_REACHED);
      }
      return res.status(201).json(
        withAudit({
          ...result.project,
          sources: result.project.sources ?? [],
          claims: result.project.claims ?? [],
        }),
      );
    } catch (error) {
      logger.error('[research] Error creating research dossier', error);
      return res.status(400).json({ error: 'Error creating research dossier' });
    }
  }

  async function getProject(req: ResearchRequest, res: Response): Promise<Response> {
    const denied = requireOwner(req, res);
    if (denied) {
      return denied;
    }
    const { researchId } = req.params;
    if (!isValidObjectIdString(researchId)) {
      return res.status(404).json(RESEARCH_NOT_FOUND);
    }
    try {
      const project = await deps.getResearchProject(getUserId(req), researchId);
      if (!project) {
        return res.status(404).json(RESEARCH_NOT_FOUND);
      }
      return res.status(200).json(
        withAudit({
          ...project,
          sources: project.sources ?? [],
          claims: project.claims ?? [],
        }),
      );
    } catch (error) {
      logger.error('[research] Error getting research dossier', error);
      return res.status(500).json({ error: 'Error getting research dossier' });
    }
  }

  async function saveProject(req: ResearchRequest, res: Response): Promise<Response> {
    const denied = requireOwner(req, res);
    if (denied) {
      return denied;
    }
    const { researchId } = req.params;
    if (!isValidObjectIdString(researchId)) {
      return res.status(404).json(RESEARCH_NOT_FOUND);
    }
    const expectedRevision = req.body?.expectedRevision;
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      return res.status(400).json({ error: 'expectedRevision must be a positive integer' });
    }
    const parsed = parseDossier(req.body, req.config?.research);
    if ('error' in parsed) {
      return res.status(400).json({ error: parsed.error });
    }
    const audit = auditResearch({
      sources: parsed.input.sources,
      claims: parsed.input.claims,
    });
    if (parsed.input.status === 'complete' && !audit.ready) {
      return res.status(409).json({
        error: 'Resolve the blocking evidence issues before completing this dossier',
        code: 'RESEARCH_NOT_READY',
        issues: audit.issues,
      });
    }

    try {
      const result = await deps.saveResearchProject(
        getUserId(req),
        researchId,
        parsed.input,
        expectedRevision,
      );
      if (result.ok) {
        return res.status(200).json(withAudit(result.project));
      }
      if (result.code === 'NOT_FOUND') {
        return res.status(404).json(RESEARCH_NOT_FOUND);
      }
      if (result.code === 'NOT_READY') {
        return res.status(409).json({
          error: 'Resolve the blocking evidence issues before completing this dossier',
          code: 'RESEARCH_NOT_READY',
          issues: audit.issues,
        });
      }
      return res.status(409).json(RESEARCH_REVISION_CONFLICT);
    } catch (error) {
      logger.error('[research] Error saving research dossier', error);
      return res.status(400).json({ error: 'Error saving research dossier' });
    }
  }

  async function deleteProject(req: ResearchRequest, res: Response): Promise<Response> {
    const denied = requireOwner(req, res);
    if (denied) {
      return denied;
    }
    const { researchId } = req.params;
    if (!isValidObjectIdString(researchId)) {
      return res.status(404).json(RESEARCH_NOT_FOUND);
    }
    try {
      const deleted = await deps.deleteResearchProject(getUserId(req), researchId);
      if (!deleted) {
        return res.status(404).json(RESEARCH_NOT_FOUND);
      }
      return res.status(200).json({ deleted: true });
    } catch (error) {
      logger.error('[research] Error deleting research dossier', error);
      return res.status(500).json({ error: 'Error deleting research dossier' });
    }
  }

  return { getCapabilities, listProjects, createProject, getProject, saveProject, deleteProject };
}
