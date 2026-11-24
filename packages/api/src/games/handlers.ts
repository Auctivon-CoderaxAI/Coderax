import { logger, isValidObjectIdString } from '@coderax/data-schemas';
import {
  GAME_CAMERAS,
  GAME_CAPABILITIES,
  GAME_GENRES,
  GAME_TEMPLATES,
  MAX_GAME_NAME_LENGTH,
  MAX_GAME_SPEC_FIELD_LENGTH,
  MAX_GAME_SUMMARY_LENGTH,
  SystemRoles,
} from 'coderax-data-provider';
import type {
  CreateGameProjectInput,
  GameProjectMethods,
  ListGameProjectsOptions,
  UpdateGameProjectInput,
} from '@coderax/data-schemas';
import type { TGamesConfig, TGameSpec } from 'coderax-data-provider';
import type { Request, Response } from 'express';
import { normalizeLimit, queryString } from '~/utils';

const GAME_NOT_FOUND = 'Game project not found';
const GAMES_DISABLED = { error: 'Game Studio is disabled', code: 'GAMES_DISABLED' };
const GAMES_OWNER_ONLY = { error: 'Game Studio is owner-only', code: 'GAMES_OWNER_ONLY' };
const GAME_LIMIT_REACHED = {
  error: 'Game project limit reached',
  code: 'GAME_PROJECT_LIMIT_REACHED',
};
const GAME_REVISION_CONFLICT = {
  error: 'Game spec was changed by another session',
  code: 'GAME_REVISION_CONFLICT',
};

interface GameUser {
  id?: string;
  role?: string;
  tenantId?: string;
  _id?: { toString(): string };
}

interface GameRequest extends Request {
  user?: GameUser;
  config?: { games?: TGamesConfig };
}

type GameHandlerDependencies = Pick<
  GameProjectMethods,
  | 'listGameProjects'
  | 'createGameProject'
  | 'getGameProject'
  | 'updateGameProject'
  | 'saveGameSpec'
  | 'deleteGameProject'
>;

const getUserId = (req: GameRequest): string => req.user?.id ?? req.user?._id?.toString() ?? '';

/**
 * Owner-only surface, matching the repository's existing owner gate:
 * an ADMIN account owns the deployment. The config can relax it, but the
 * default is the requirement.
 */
const isOwner = (req: GameRequest): boolean =>
  req.config?.games?.ownerOnly === false || req.user?.role === SystemRoles.ADMIN;

const requireOwner = (req: GameRequest, res: Response): Response | null => {
  if (req.config?.games?.enabled === false) {
    return res.status(403).json(GAMES_DISABLED);
  }
  if (!isOwner(req)) {
    return res.status(403).json(GAMES_OWNER_ONLY);
  }
  return null;
};

const normalizeString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const isGenre = (value: unknown): value is TGameSpec['genre'] =>
  typeof value === 'string' && (GAME_GENRES as readonly string[]).includes(value);

const isCamera = (value: unknown): value is TGameSpec['camera'] =>
  typeof value === 'string' && (GAME_CAMERAS as readonly string[]).includes(value);

const boundedText = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.length <= max ? value.trim() : null;

const parseSpec = (
  value: unknown,
  gamesConfig?: TGamesConfig,
): { spec: TGameSpec } | { error: string } => {
  if (!value || typeof value !== 'object') {
    return { error: 'spec is required' };
  }
  const input = value as Record<string, unknown>;
  const maxPromptLength = gamesConfig?.maxSpecPromptLength;
  const prompt = boundedText(input.prompt, maxPromptLength ?? MAX_GAME_SPEC_FIELD_LENGTH);
  if (prompt == null) {
    return { error: 'spec.prompt must be a string within the configured length' };
  }
  if (!prompt) {
    return { error: 'spec.prompt is required' };
  }
  if (!isGenre(input.genre)) {
    return { error: 'spec.genre is not a known genre' };
  }
  if (!isCamera(input.camera)) {
    return { error: 'spec.camera is not a known camera' };
  }
  if (input.players !== 1 && input.players !== 2) {
    return { error: 'spec.players must be 1 or 2' };
  }
  const coreLoop = boundedText(input.coreLoop ?? '', MAX_GAME_SPEC_FIELD_LENGTH);
  const winCondition = boundedText(input.winCondition ?? '', MAX_GAME_SPEC_FIELD_LENGTH);
  const artDirection = boundedText(input.artDirection ?? '', MAX_GAME_SPEC_FIELD_LENGTH);
  if (coreLoop == null || winCondition == null || artDirection == null) {
    return { error: 'spec text fields exceed their maximum length' };
  }

  return {
    spec: {
      prompt,
      genre: input.genre,
      camera: input.camera,
      players: input.players,
      coreLoop,
      winCondition,
      artDirection,
    },
  };
};

const templateSpec = (templateId: unknown): TGameSpec | undefined => {
  if (typeof templateId !== 'string' || !templateId) {
    return undefined;
  }
  return GAME_TEMPLATES.find((template) => template.id === templateId)?.spec;
};

export function createGameHandlers(deps: GameHandlerDependencies): {
  getCapabilities: (req: GameRequest, res: Response) => Response;
  listProjects: (req: GameRequest, res: Response) => Promise<Response>;
  createProject: (req: GameRequest, res: Response) => Promise<Response>;
  getProject: (req: GameRequest, res: Response) => Promise<Response>;
  updateProject: (req: GameRequest, res: Response) => Promise<Response>;
  deleteProject: (req: GameRequest, res: Response) => Promise<Response>;
  saveSpec: (req: GameRequest, res: Response) => Promise<Response>;
} {
  function getCapabilities(req: GameRequest, res: Response): Response {
    const denied = requireOwner(req, res);
    if (denied) {
      return denied;
    }
    /** Static, because no executor contract exists to report against yet. */
    return res.status(200).json(GAME_CAPABILITIES);
  }

  async function listProjects(req: GameRequest, res: Response): Promise<Response> {
    const denied = requireOwner(req, res);
    if (denied) {
      return denied;
    }
    const options: ListGameProjectsOptions = {
      cursor: queryString(req.query.cursor),
      limit: normalizeLimit(req.query.limit),
      search: queryString(req.query.search),
    };
    try {
      const result = await deps.listGameProjects(getUserId(req), options);
      return res.status(200).json(result);
    } catch (error) {
      logger.error('[games] Error listing game projects', error);
      return res.status(500).json({ error: 'Error listing game projects' });
    }
  }

  async function createProject(req: GameRequest, res: Response): Promise<Response> {
    const denied = requireOwner(req, res);
    if (denied) {
      return denied;
    }
    const name = normalizeString(req.body?.name);
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (name.length > MAX_GAME_NAME_LENGTH) {
      return res.status(400).json({ error: 'name is too long' });
    }
    const summary = req.body?.summary === undefined ? '' : normalizeString(req.body.summary);
    if (summary.length > (req.config?.games?.maxSummaryLength ?? MAX_GAME_SUMMARY_LENGTH)) {
      return res.status(400).json({ error: 'summary is too long' });
    }

    const input: CreateGameProjectInput = {
      name,
      summary,
      spec: templateSpec(req.body?.templateId) ?? null,
    };
    try {
      const result = await deps.createGameProject(getUserId(req), input, {
        maxProjectsPerOwner: req.config?.games?.maxProjectsPerOwner,
      });
      if (!result.ok) {
        return res.status(409).json(GAME_LIMIT_REACHED);
      }
      return res.status(201).json(result.project);
    } catch (error) {
      logger.error('[games] Error creating game project', error);
      return res.status(400).json({ error: 'Error creating game project' });
    }
  }

  async function getProject(req: GameRequest, res: Response): Promise<Response> {
    const denied = requireOwner(req, res);
    if (denied) {
      return denied;
    }
    const { gameId } = req.params;
    if (!isValidObjectIdString(gameId)) {
      return res.status(404).json({ error: GAME_NOT_FOUND });
    }
    try {
      const project = await deps.getGameProject(getUserId(req), gameId);
      if (!project) {
        return res.status(404).json({ error: GAME_NOT_FOUND });
      }
      return res.status(200).json(project);
    } catch (error) {
      logger.error('[games] Error getting game project', error);
      return res.status(500).json({ error: 'Error getting game project' });
    }
  }

  async function updateProject(req: GameRequest, res: Response): Promise<Response> {
    const denied = requireOwner(req, res);
    if (denied) {
      return denied;
    }
    const { gameId } = req.params;
    if (!isValidObjectIdString(gameId)) {
      return res.status(404).json({ error: GAME_NOT_FOUND });
    }

    const input: UpdateGameProjectInput = {};
    if (req.body?.name !== undefined) {
      const name = normalizeString(req.body.name);
      if (!name || name.length > MAX_GAME_NAME_LENGTH) {
        return res.status(400).json({ error: 'name must be a non-empty project name' });
      }
      input.name = name;
    }
    if (req.body?.summary !== undefined) {
      const summary = normalizeString(req.body.summary);
      if (summary.length > (req.config?.games?.maxSummaryLength ?? MAX_GAME_SUMMARY_LENGTH)) {
        return res.status(400).json({ error: 'summary is too long' });
      }
      input.summary = summary;
    }

    try {
      const project = await deps.updateGameProject(getUserId(req), gameId, input);
      if (!project) {
        return res.status(404).json({ error: GAME_NOT_FOUND });
      }
      return res.status(200).json(project);
    } catch (error) {
      logger.error('[games] Error updating game project', error);
      return res.status(500).json({ error: 'Error updating game project' });
    }
  }

  async function deleteProject(req: GameRequest, res: Response): Promise<Response> {
    const denied = requireOwner(req, res);
    if (denied) {
      return denied;
    }
    const { gameId } = req.params;
    if (!isValidObjectIdString(gameId)) {
      return res.status(404).json({ error: GAME_NOT_FOUND });
    }
    try {
      const deleted = await deps.deleteGameProject(getUserId(req), gameId);
      if (!deleted) {
        return res.status(404).json({ error: GAME_NOT_FOUND });
      }
      return res.status(200).json({ deleted: true });
    } catch (error) {
      logger.error('[games] Error deleting game project', error);
      return res.status(500).json({ error: 'Error deleting game project' });
    }
  }

  async function saveSpec(req: GameRequest, res: Response): Promise<Response> {
    const denied = requireOwner(req, res);
    if (denied) {
      return denied;
    }
    const { gameId } = req.params;
    if (!isValidObjectIdString(gameId)) {
      return res.status(404).json({ error: GAME_NOT_FOUND });
    }
    const expectedRevision = req.body?.expectedRevision;
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      return res.status(400).json({ error: 'expectedRevision must be a positive integer' });
    }
    const parsed = parseSpec(req.body?.spec, req.config?.games);
    if ('error' in parsed) {
      return res.status(400).json({ error: parsed.error });
    }

    try {
      const result = await deps.saveGameSpec(getUserId(req), gameId, parsed.spec, expectedRevision);
      if (result.ok) {
        return res.status(200).json(result.project);
      }
      if (result.code === 'NOT_FOUND') {
        return res.status(404).json({ error: GAME_NOT_FOUND });
      }
      return res.status(409).json(GAME_REVISION_CONFLICT);
    } catch (error) {
      logger.error('[games] Error saving game spec', error);
      return res.status(500).json({ error: 'Error saving game spec' });
    }
  }

  return {
    getCapabilities,
    listProjects,
    createProject,
    getProject,
    updateProject,
    deleteProject,
    saveSpec,
  };
}
