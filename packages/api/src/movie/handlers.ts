import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import type { IMovieProject, MovieProjectMethods } from '@coderax/data-schemas';
import { isValidObjectIdString, logger, MOVIE_PROJECT_CONFLICT } from '@coderax/data-schemas';
import type {
  MovieShotStatus,
  TMovieJob,
  TMovieProject,
  TMovieScene,
  TMovieServiceState,
} from 'coderax-data-provider';
import { echoProtocolProject } from './echoProtocol';
import { NeonFrameError, type NeonFrameClient } from './neonframe';
import { parseCharacters, parseScenes, planSceneShots } from './planner';
import { createJobId, findShot, MovieRequestError, queueShotGeneration } from './runner';

type MovieUser = {
  id?: string;
  email?: string;
  role?: string;
  _id?: { toString(): string };
};

type MovieRequest = Request & { user?: MovieUser };

type MovieHandlerDeps = Pick<
  MovieProjectMethods,
  | 'listMovieProjects'
  | 'getMovieProject'
  | 'createMovieProject'
  | 'updateMovieProject'
  | 'appendMovieJob'
  | 'updateMovieJob'
  | 'deleteMovieProject'
> & {
  createClient: () => NeonFrameClient;
  newJobId?: () => string;
  now?: () => Date;
};

const PROJECT_NOT_FOUND = 'Movie project not found';

function userId(req: MovieRequest): string {
  return req.user?.id ?? req.user?._id?.toString() ?? '';
}

function isOwner(req: MovieRequest): boolean {
  const id = userId(req);
  if (!id) {
    return false;
  }
  const allowedIds = (process.env.MOVIE_OWNER_USER_IDS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const allowedEmails = (process.env.MOVIE_OWNER_EMAILS ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (req.user?.role === 'ADMIN' || allowedIds.includes(id)) {
    return true;
  }
  return Boolean(req.user?.email && allowedEmails.includes(req.user.email.toLowerCase()));
}

function toProject(doc: IMovieProject): TMovieProject {
  return {
    id: doc._id ? String(doc._id) : '',
    title: doc.title,
    logline: doc.logline ?? '',
    genre: doc.genre ?? '',
    ratingTarget: doc.ratingTarget ?? '',
    aspectRatio: doc.aspectRatio === '9:16' ? '9:16' : '16:9',
    status: doc.status ?? 'development',
    characters: doc.characters ?? [],
    scenes: doc.scenes ?? [],
    jobs: doc.jobs ?? [],
    revision: doc.revision ?? 0,
    createdAt: doc.createdAt?.toISOString() ?? '',
    updatedAt: doc.updatedAt?.toISOString() ?? '',
  };
}

function bodyOf(req: MovieRequest): Record<string, unknown> {
  return typeof req.body === 'object' && req.body !== null
    ? (req.body as Record<string, unknown>)
    : {};
}

function summarize(project: TMovieProject) {
  const shots = project.scenes.flatMap((scene) => scene.shots);
  return {
    plannedShots: shots.filter((shot) => shot.status === 'planned').length,
    blockedShots: shots.filter((shot) => shot.status === 'blocked').length,
    approvedShots: shots.filter((shot) => shot.status === 'approved').length,
    runningJobs: project.jobs.filter((job) => job.state === 'running').length,
  };
}

function counts(project: TMovieProject) {
  return summarize(project);
}

function failure(res: Response, error: unknown): Response {
  if (error instanceof MovieRequestError) {
    return res.status(error.status).json({ code: error.code, error: error.message });
  }
  if (error instanceof NeonFrameError) {
    return res.status(503).json({ code: error.code, error: error.message });
  }
  if (error instanceof TypeError) {
    return res.status(400).json({ code: 'INVALID_MOVIE_REQUEST', error: error.message });
  }
  if (error instanceof Error && error.message === MOVIE_PROJECT_CONFLICT) {
    return res.status(409).json({ code: 'MOVIE_PROJECT_CONFLICT', error: 'Project changed' });
  }
  logger.error('[movie] Request failed', error);
  return res.status(500).json({ code: 'MOVIE_REQUEST_FAILED', error: 'Movie request failed' });
}

function requireOwner(req: MovieRequest, res: Response): boolean {
  if (isOwner(req)) {
    return true;
  }
  res.status(403).json({
    code: 'MOVIE_OWNER_REQUIRED',
    error: 'The movie production hub is restricted to the configured owner account',
  });
  return false;
}

function replaceShot(
  scenes: TMovieScene[],
  sceneId: string,
  shotId: string,
  change: (shot: TMovieScene['shots'][number]) => TMovieScene['shots'][number],
): TMovieScene[] {
  return scenes.map((scene) =>
    scene.id === sceneId
      ? {
          ...scene,
          shots: scene.shots.map((shot) => (shot.id === shotId ? change(shot) : shot)),
        }
      : scene,
  );
}

function jobReceipt(
  kind: TMovieJob['kind'],
  state: TMovieJob['state'],
  providerJobId: string | null,
  checkpoint: string,
  now: Date,
  id: string,
): TMovieJob {
  return {
    id,
    sceneId: '',
    shotId: null,
    kind,
    state,
    providerJobId,
    provider: 'neonframe',
    errorCode: null,
    errorMessage: null,
    attempts: 1,
    checkpoint,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

type MovieHandler = (req: MovieRequest, res: Response) => Promise<Response>;

export function createMovieHandlers(deps: MovieHandlerDeps): {
  serviceStatus: MovieHandler;
  listProjects: MovieHandler;
  createProject: MovieHandler;
  seedProject: MovieHandler;
  getProject: MovieHandler;
  updateProject: MovieHandler;
  deleteProject: MovieHandler;
  planScene: MovieHandler;
  generateShot: MovieHandler;
  reviewShot: MovieHandler;
  audioPlan: MovieHandler;
  assemblyPlan: MovieHandler;
  productionStatus: MovieHandler;
} {
  const now = deps.now ?? (() => new Date());
  const newJobId = deps.newJobId ?? createJobId;

  async function serviceStatus(_req: MovieRequest, res: Response): Promise<Response> {
    try {
      const client = deps.createClient();
      const services = await client.status();
      return res.status(200).json({
        services,
        providerReady: services.every((service) => service.ready),
      });
    } catch (error) {
      return failure(res, error);
    }
  }

  async function listProjects(req: MovieRequest, res: Response): Promise<Response> {
    if (!requireOwner(req, res)) {
      return res;
    }
    try {
      const projects = await deps.listMovieProjects(userId(req));
      return res.status(200).json(projects.map(toProject));
    } catch (error) {
      return failure(res, error);
    }
  }

  async function createProject(req: MovieRequest, res: Response): Promise<Response> {
    if (!requireOwner(req, res)) {
      return res;
    }
    try {
      const body = bodyOf(req);
      if (typeof body.title !== 'string' || !body.title.trim()) {
        return res.status(400).json({ code: 'TITLE_REQUIRED', error: 'title is required' });
      }
      const project = await deps.createMovieProject(userId(req), {
        title: body.title,
        logline: typeof body.logline === 'string' ? body.logline : '',
        genre: typeof body.genre === 'string' ? body.genre : '',
        ratingTarget: typeof body.ratingTarget === 'string' ? body.ratingTarget : undefined,
        aspectRatio: body.aspectRatio === '9:16' ? '9:16' : '16:9',
        characters: parseCharacters(body.characters),
        scenes: parseScenes(body.scenes),
      });
      return res.status(201).json(toProject(project));
    } catch (error) {
      return failure(res, error);
    }
  }

  async function seedProject(req: MovieRequest, res: Response): Promise<Response> {
    if (!requireOwner(req, res)) {
      return res;
    }
    try {
      const user = userId(req);
      const existing = (await deps.listMovieProjects(user)).find(
        (project) => project.title === 'ECHO PROTOCOL',
      );
      if (existing) {
        const full = await deps.getMovieProject(user, existing._id?.toString() ?? '');
        return res.status(200).json({ project: toProject(full ?? existing), created: false });
      }
      const fixture = echoProtocolProject();
      const plannedScenes = (fixture.scenes ?? []).map((scene) => ({
        ...scene,
        shots: planSceneShots(scene),
      }));
      const created = await deps.createMovieProject(user, {
        ...fixture,
        scenes: plannedScenes,
      });
      return res.status(201).json({ project: toProject(created), created: true });
    } catch (error) {
      return failure(res, error);
    }
  }

  async function getProject(req: MovieRequest, res: Response): Promise<Response> {
    if (!requireOwner(req, res)) {
      return res;
    }
    try {
      const project = await deps.getMovieProject(userId(req), req.params.projectId);
      if (!project) {
        return res.status(404).json({ code: 'PROJECT_NOT_FOUND', error: PROJECT_NOT_FOUND });
      }
      return res.status(200).json(toProject(project));
    } catch (error) {
      return failure(res, error);
    }
  }

  async function updateProject(req: MovieRequest, res: Response): Promise<Response> {
    if (!requireOwner(req, res)) {
      return res;
    }
    try {
      const body = bodyOf(req);
      const project = await deps.getMovieProject(userId(req), req.params.projectId);
      if (!project) {
        return res.status(404).json({ code: 'PROJECT_NOT_FOUND', error: PROJECT_NOT_FOUND });
      }
      /* Replacing the scene plan preserves the review state of an existing shot by id. */
      let scenes: TMovieScene[] | undefined;
      if (body.scenes !== undefined) {
        const incoming = parseScenes(body.scenes);
        const previous = new Map(
          (project.scenes ?? []).flatMap((scene) =>
            scene.shots.map((shot) => [shot.id, shot] as const),
          ),
        );
        scenes = incoming.map((scene) => ({
          ...scene,
          shots: scene.shots.map((shot) => {
            const old = previous.get(shot.id);
            return old
              ? {
                  ...shot,
                  status: old.status,
                  artifactId: old.artifactId ?? null,
                  lastJobId: old.lastJobId ?? null,
                }
              : shot;
          }),
        }));
      }
      const updated = await deps.updateMovieProject(userId(req), req.params.projectId, {
        title: typeof body.title === 'string' ? body.title : undefined,
        logline: typeof body.logline === 'string' ? body.logline : undefined,
        status:
          body.status === 'development' ||
          body.status === 'production' ||
          body.status === 'review' ||
          body.status === 'complete'
            ? body.status
            : undefined,
        characters:
          body.characters === undefined ? undefined : parseCharacters(body.characters),
        scenes,
      });
      return res.status(200).json(toProject(updated ?? project));
    } catch (error) {
      return failure(res, error);
    }
  }

  async function deleteProject(req: MovieRequest, res: Response): Promise<Response> {
    if (!requireOwner(req, res)) {
      return res;
    }
    try {
      if (!isValidObjectIdString(req.params.projectId)) {
        return res.status(404).json({ code: 'PROJECT_NOT_FOUND', error: PROJECT_NOT_FOUND });
      }
      const deleted = await deps.deleteMovieProject(userId(req), req.params.projectId);
      if (!deleted) {
        return res.status(404).json({ code: 'PROJECT_NOT_FOUND', error: PROJECT_NOT_FOUND });
      }
      return res.status(200).json({ deleted: true });
    } catch (error) {
      return failure(res, error);
    }
  }

  async function planScene(req: MovieRequest, res: Response): Promise<Response> {
    if (!requireOwner(req, res)) {
      return res;
    }
    try {
      const project = await deps.getMovieProject(userId(req), req.params.projectId);
      if (!project) {
        return res.status(404).json({ code: 'PROJECT_NOT_FOUND', error: PROJECT_NOT_FOUND });
      }
      const scene = (project.scenes ?? []).find((entry) => entry.id === req.params.sceneId);
      if (!scene) {
        return res.status(404).json({ code: 'SCENE_NOT_FOUND', error: 'Scene not found' });
      }
      const scenes = (project.scenes ?? []).map((entry) =>
        entry.id === scene.id ? { ...entry, shots: planSceneShots(entry) } : entry,
      );
      const updated = await deps.updateMovieProject(userId(req), toProject(project).id, {
        scenes,
      });
      return res.status(200).json(toProject(updated ?? { ...project, scenes }));
    } catch (error) {
      return failure(res, error);
    }
  }

  async function generateShot(req: MovieRequest, res: Response): Promise<Response> {
    if (!requireOwner(req, res)) {
      return res;
    }
    try {
      const project = await deps.getMovieProject(userId(req), req.params.projectId);
      if (!project) {
        return res.status(404).json({ code: 'PROJECT_NOT_FOUND', error: PROJECT_NOT_FOUND });
      }
      const mapped = toProject(project);
      const result = await queueShotGeneration({
        project: mapped,
        sceneId: req.params.sceneId,
        shotId: req.params.shotId,
        client: deps.createClient(),
        now,
        newId: newJobId,
      });
      const job: TMovieJob = {
        ...result.job,
        sceneId: req.params.sceneId,
        shotId: req.params.shotId,
      };
      await deps.appendMovieJob(userId(req), mapped.id, job);
      const scenes = replaceShot(mapped.scenes, req.params.sceneId, req.params.shotId, (shot) => ({
        ...shot,
        status: result.shotStatus,
        prompt: result.prompt || shot.prompt,
        lastJobId: job.id,
        notes:
          job.state === 'blocked'
            ? `${job.errorCode ?? 'BLOCKED'}: ${job.errorMessage ?? 'provider not ready'}`
            : shot.notes,
      }));
      const updated = await deps.updateMovieProject(userId(req), mapped.id, { scenes });
      return res.status(202).json({ job, project: toProject(updated ?? { ...project, scenes }) });
    } catch (error) {
      return failure(res, error);
    }
  }

  async function reviewShot(req: MovieRequest, res: Response): Promise<Response> {
    if (!requireOwner(req, res)) {
      return res;
    }
    try {
      const decision = bodyOf(req).decision;
      if (decision !== 'approve' && decision !== 'reject') {
        return res
          .status(400)
          .json({ code: 'INVALID_DECISION', error: 'decision must be approve or reject' });
      }
      const project = await deps.getMovieProject(userId(req), req.params.projectId);
      if (!project) {
        return res.status(404).json({ code: 'PROJECT_NOT_FOUND', error: PROJECT_NOT_FOUND });
      }
      const mapped = toProject(project);
      const { shot } = findShot(mapped, req.params.sceneId, req.params.shotId);
      if (decision === 'approve' && !shot.artifactId) {
        return res.status(409).json({
          code: 'SHOT_NOT_RENDERED',
          error: 'A shot cannot be approved before a verified rendered artifact exists',
        });
      }
      const status: MovieShotStatus = decision === 'approve' ? 'approved' : 'rejected';
      const scenes = replaceShot(mapped.scenes, req.params.sceneId, req.params.shotId, (entry) => ({
        ...entry,
        status,
      }));
      const updated = await deps.updateMovieProject(userId(req), mapped.id, { scenes });
      return res.status(200).json(toProject(updated ?? { ...project, scenes }));
    } catch (error) {
      return failure(res, error);
    }
  }

  async function audioPlan(req: MovieRequest, res: Response): Promise<Response> {
    if (!requireOwner(req, res)) {
      return res;
    }
    try {
      const project = await deps.getMovieProject(userId(req), req.params.projectId);
      if (!project) {
        return res.status(404).json({ code: 'PROJECT_NOT_FOUND', error: PROJECT_NOT_FOUND });
      }
      const mapped = toProject(project);
      const scene = mapped.scenes.find((entry) => entry.id === req.params.sceneId);
      if (!scene) {
        return res.status(404).json({ code: 'SCENE_NOT_FOUND', error: 'Scene not found' });
      }
      const dialogue = scene.shots.flatMap((shot) =>
        shot.dialogue
          .filter((line) => line.endSeconds !== undefined)
          .map((line, index) => ({
            id: `${shot.id}-D${index + 1}`,
            speakerId: line.speakerId,
            text: line.text,
            startSeconds: line.startSeconds ?? 0,
            endSeconds: line.endSeconds ?? (line.startSeconds ?? 0) + 2,
          })),
      );
      if (dialogue.length === 0) {
        return res.status(409).json({
          code: 'NO_TIMED_DIALOGUE',
          error: 'The scene has no authored dialogue timing to plan',
        });
      }
      const plan = await deps.createClient().planAudio({ projectId: mapped.id, dialogue });
      const timestamp = now();
      const job = jobReceipt(
        'audio',
        'succeeded',
        null,
        'audio_plan_created',
        timestamp,
        newJobId(),
      );
      await deps.appendMovieJob(userId(req), mapped.id, {
        ...job,
        sceneId: scene.id,
      });
      return res.status(200).json({ plan, job });
    } catch (error) {
      return failure(res, error);
    }
  }

  async function assemblyPlan(req: MovieRequest, res: Response): Promise<Response> {
    if (!requireOwner(req, res)) {
      return res;
    }
    try {
      const project = await deps.getMovieProject(userId(req), req.params.projectId);
      if (!project) {
        return res.status(404).json({ code: 'PROJECT_NOT_FOUND', error: PROJECT_NOT_FOUND });
      }
      const mapped = toProject(project);
      const shots = mapped.scenes
        .flatMap((scene) => scene.shots)
        .filter((shot) => Boolean(shot.artifactId))
        .map((shot) => ({
          shotId: shot.id,
          assetId: shot.artifactId as string,
          durationSeconds: shot.durationSeconds,
        }));
      if (shots.length === 0) {
        return res.status(409).json({
          code: 'NO_RENDERED_ASSETS',
          error:
            'Assembly requires rendered shot artifacts; no shot has a verified artifact yet',
        });
      }
      const plan = await deps.createClient().planAssembly({
        projectId: mapped.id,
        aspectRatio: mapped.aspectRatio,
        fps: 24,
        shots,
      });
      const timestamp = now();
      const job = jobReceipt(
        'assembly',
        'succeeded',
        null,
        'assembly_plan_created',
        timestamp,
        newJobId(),
      );
      await deps.appendMovieJob(userId(req), mapped.id, job);
      return res.status(200).json({ plan, job });
    } catch (error) {
      return failure(res, error);
    }
  }

  async function productionStatus(req: MovieRequest, res: Response): Promise<Response> {
    if (!requireOwner(req, res)) {
      return res;
    }
    try {
      const project = await deps.getMovieProject(userId(req), req.params.projectId);
      if (!project) {
        return res.status(404).json({ code: 'PROJECT_NOT_FOUND', error: PROJECT_NOT_FOUND });
      }
      const mapped = toProject(project);
      const services: TMovieServiceState[] = await deps.createClient().status();
      return res.status(200).json({
        projectId: mapped.id,
        providerReady: services.every((service) => service.ready),
        services,
        ...counts(mapped),
      });
    } catch (error) {
      return failure(res, error);
    }
  }

  return {
    serviceStatus,
    listProjects,
    createProject,
    seedProject,
    getProject,
    updateProject,
    deleteProject,
    planScene,
    generateShot,
    reviewShot,
    audioPlan,
    assemblyPlan,
    productionStatus,
  };
}

export type MovieHandlers = ReturnType<typeof createMovieHandlers>;
