import { randomUUID } from 'node:crypto';
import type { MovieShotStatus, TMovieJob, TMovieProject, TMovieShot } from 'coderax-data-provider';
import { buildShotPrompt } from './planner';
import { NeonFrameError, type NeonFrameClient } from './neonframe';

export type QueueShotInput = {
  project: TMovieProject;
  sceneId: string;
  shotId: string;
  client: NeonFrameClient;
  now: () => Date;
  newId: () => string;
};

export type QueueShotResult = {
  job: TMovieJob;
  shotStatus: MovieShotStatus;
  prompt: string;
};

export class MovieRequestError extends Error {
  status: number;
  code: string;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'MovieRequestError';
    this.code = code;
    this.status = status;
  }
}

export function createJobId(): string {
  return `mv_${randomUUID()}`;
}

export function findShot(
  project: TMovieProject,
  sceneId: string,
  shotId: string,
): { scene: TMovieProject['scenes'][number]; shot: TMovieShot } {
  const scene = project.scenes.find((entry) => entry.id === sceneId);
  if (!scene) {
    throw new MovieRequestError('SCENE_NOT_FOUND', 'Scene not found', 404);
  }
  const shot = scene.shots.find((entry) => entry.id === shotId);
  if (!shot) {
    throw new MovieRequestError('SHOT_NOT_FOUND', 'Shot not found', 404);
  }
  return { scene, shot };
}

function blockedJob(
  base: TMovieJob,
  code: string,
  message: string,
): TMovieJob {
  return {
    ...base,
    state: 'blocked',
    errorCode: code,
    errorMessage: message.slice(0, 500),
    checkpoint: 'provider_readiness',
  };
}

/**
 * Submits one shot only when the configured provider reports readiness. A blocked
 * provider produces a durable blocked job with the provider's own code, rather than
 * a fake success or an untracked exception.
 *
 * `movie-generation` currently accepts a submission but exposes no job-status route,
 * so an accepted job stops at `provider_accepted`. That checkpoint is reported as-is;
 * the shot is not treated as rendered and cannot be approved.
 */
export async function queueShotGeneration({
  project,
  sceneId,
  shotId,
  client,
  now,
  newId,
}: QueueShotInput): Promise<QueueShotResult> {
  const { scene, shot } = findShot(project, sceneId, shotId);
  if (shot.status === 'approved') {
    throw new MovieRequestError('SHOT_APPROVED', 'An approved shot cannot be re-rendered', 409);
  }

  const timestamp = now().toISOString();
  const base: TMovieJob = {
    id: newId(),
    sceneId,
    shotId,
    kind: 'generation',
    state: 'queued',
    providerJobId: null,
    provider: 'neonframe',
    errorCode: null,
    errorMessage: null,
    attempts: 1,
    checkpoint: 'validated',
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const services = await client.status();
  const generation = services.find((service) => service.service === 'generation');
  if (!generation?.ready) {
    return {
      job: blockedJob(
        base,
        generation?.code ?? 'VIDEO_PROVIDER_UNAVAILABLE',
        generation?.detail ?? 'NeonFrame generation service is not ready',
      ),
      shotStatus: 'blocked',
      prompt: '',
    };
  }

  const prompt = buildShotPrompt(project, scene, shot, project.characters);
  try {
    const receipt = await client.submitGeneration({
      projectId: project.id,
      sceneId,
      prompt,
      workflowId: client.config.workflowId ?? '',
      durationSeconds: shot.durationSeconds,
      aspectRatio: project.aspectRatio,
    });
    return {
      job: {
        ...base,
        state: 'running',
        providerJobId: receipt.jobId,
        provider: receipt.provider,
        checkpoint: 'provider_accepted',
        updatedAt: now().toISOString(),
      },
      shotStatus: 'generating',
      prompt,
    };
  } catch (error) {
    if (error instanceof NeonFrameError) {
      return {
        job: blockedJob(base, error.code, error.message),
        shotStatus: 'blocked',
        prompt,
      };
    }
    throw error;
  }
}
