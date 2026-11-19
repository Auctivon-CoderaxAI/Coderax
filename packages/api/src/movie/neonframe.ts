import type { TMovieServiceState } from 'coderax-data-provider';

const DEFAULT_TIMEOUT_MS = 5000;

export type NeonFrameService = 'generation' | 'render' | 'audio';

export type NeonFrameConfig = {
  generationUrl: string | null;
  renderUrl: string | null;
  audioUrl: string | null;
  token: string | null;
  workflowId: string | null;
  timeoutMs: number;
};

export type GenerationSubmission = {
  projectId: string;
  sceneId: string;
  prompt: string;
  workflowId: string;
  durationSeconds: number;
  aspectRatio: '16:9' | '9:16';
};

export type GenerationReceipt = {
  jobId: string;
  provider: string;
  state: string;
};

export type AudioPlanInput = {
  projectId: string;
  dialogue: Array<{
    id: string;
    speakerId: string;
    text: string;
    startSeconds: number;
    endSeconds: number;
  }>;
};

export type AssemblyPlanInput = {
  projectId: string;
  aspectRatio: '16:9' | '9:16';
  fps: number;
  shots: Array<{ shotId: string; assetId: string; durationSeconds: number }>;
  audioAssetIds?: string[];
};

export type NeonFrameClient = {
  config: NeonFrameConfig;
  status(): Promise<TMovieServiceState[]>;
  submitGeneration(input: GenerationSubmission): Promise<GenerationReceipt>;
  planAudio(input: AudioPlanInput): Promise<Record<string, unknown>>;
  planAssembly(input: AssemblyPlanInput): Promise<Record<string, unknown>>;
};

export class NeonFrameError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 502) {
    super(message);
    this.name = 'NeonFrameError';
    this.code = code;
    this.status = status;
  }
}

function readUrl(value: string | undefined, label: string): string | null {
  if (!value?.trim()) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`${label} must be an absolute URL`);
  }
  const loopback = ['127.0.0.1', '::1', 'localhost'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error(`${label} must use HTTPS, or HTTP on loopback for local production`);
  }
  return url.toString().replace(/\/$/, '');
}

export function neonFrameConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): NeonFrameConfig {
  return {
    generationUrl: readUrl(env.NEONFRAME_GENERATION_URL, 'NEONFRAME_GENERATION_URL'),
    renderUrl: readUrl(env.NEONFRAME_RENDER_URL, 'NEONFRAME_RENDER_URL'),
    audioUrl: readUrl(env.NEONFRAME_AUDIO_URL, 'NEONFRAME_AUDIO_URL'),
    token: env.NEONFRAME_SERVICE_TOKEN?.trim() || null,
    workflowId: env.NEONFRAME_VIDEO_WORKFLOW_ID?.trim() || null,
    timeoutMs: Number(env.NEONFRAME_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
  };
}

type FetchLike = typeof fetch;

function serviceUrl(config: NeonFrameConfig, service: NeonFrameService): string | null {
  if (service === 'generation') {
    return config.generationUrl;
  }
  return service === 'render' ? config.renderUrl : config.audioUrl;
}

async function readFailure(response: Response): Promise<{ code: string; message: string }> {
  try {
    const body = (await response.json()) as {
      error?: { code?: unknown; message?: unknown };
      provider?: { code?: unknown; state?: unknown };
    };
    /* `/ready` answers 503 with the provider's own state, not an error envelope. */
    const providerCode = body.provider?.code;
    const providerState = body.provider?.state;
    const code =
      typeof body.error?.code === 'string'
        ? body.error.code
        : typeof providerCode === 'string'
          ? providerCode
          : 'SERVICE_HTTP_ERROR';
    const message =
      typeof body.error?.message === 'string'
        ? body.error.message.slice(0, 300)
        : typeof providerState === 'string'
          ? `provider state: ${providerState}`
          : `service returned HTTP ${response.status}`;
    return { code, message };
  } catch {
    return { code: 'SERVICE_HTTP_ERROR', message: `service returned HTTP ${response.status}` };
  }
}

async function request(
  config: NeonFrameConfig,
  service: NeonFrameService,
  path: string,
  init: RequestInit,
  fetchImpl: FetchLike,
): Promise<Response> {
  const base = serviceUrl(config, service);
  if (!base) {
    throw new NeonFrameError('SERVICE_NOT_CONFIGURED', `${service} service URL is not configured`, 503);
  }
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  if (init.body) {
    headers.set('content-type', 'application/json');
  }
  if (config.token) {
    headers.set('authorization', `Bearer ${config.token}`);
  }
  try {
    return await fetchImpl(`${base}${path}`, {
      ...init,
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch {
    throw new NeonFrameError('SERVICE_UNREACHABLE', `${service} service is unreachable`, 502);
  }
}

export function createNeonFrameClient(
  config: NeonFrameConfig,
  fetchImpl: FetchLike = fetch,
): NeonFrameClient {
  async function serviceState(service: NeonFrameService): Promise<TMovieServiceState> {
    if (!serviceUrl(config, service)) {
      return {
        service,
        configured: false,
        ready: false,
        code: 'SERVICE_NOT_CONFIGURED',
        detail: null,
      };
    }
    try {
      const response = await request(config, service, '/ready', { method: 'GET' }, fetchImpl);
      if (response.ok) {
        return { service, configured: true, ready: true, code: null, detail: null };
      }
      const failure = await readFailure(response);
      return {
        service,
        configured: true,
        ready: false,
        code: failure.code,
        detail: failure.message,
      };
    } catch (error) {
      const failure = error as NeonFrameError;
      return {
        service,
        configured: true,
        ready: false,
        code: failure.code ?? 'SERVICE_UNREACHABLE',
        detail: null,
      };
    }
  }

  async function postJson(
    service: NeonFrameService,
    path: string,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    const response = await request(
      config,
      service,
      path,
      { method: 'POST', body: JSON.stringify(body) },
      fetchImpl,
    );
    if (!response.ok) {
      const failure = await readFailure(response);
      throw new NeonFrameError(failure.code, failure.message, response.status);
    }
    try {
      const parsed = (await response.json()) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('invalid');
      }
      return parsed;
    } catch {
      throw new NeonFrameError('INVALID_SERVICE_RESPONSE', `${service} returned invalid JSON`);
    }
  }

  return {
    config,
    status: async () =>
      Promise.all([
        serviceState('generation'),
        serviceState('render'),
        serviceState('audio'),
      ]),
    submitGeneration: async (input) => {
      if (!config.workflowId) {
        throw new NeonFrameError(
          'VIDEO_WORKFLOW_NOT_CONFIGURED',
          'NEONFRAME_VIDEO_WORKFLOW_ID is not configured',
          503,
        );
      }
      const result = await postJson('generation', '/v1/generations', {
        ...input,
        workflowId: config.workflowId,
      });
      if (typeof result.jobId !== 'string' || !result.jobId) {
        throw new NeonFrameError('INVALID_SERVICE_RESPONSE', 'generation returned no jobId');
      }
      return {
        jobId: result.jobId,
        provider: typeof result.provider === 'string' ? result.provider : 'unknown',
        state: typeof result.state === 'string' ? result.state : 'submitted',
      };
    },
    planAudio: async (input) => await postJson('audio', '/v1/audio-plans', input),
    planAssembly: async (input) =>
      await postJson('render', '/v1/assembly-plans', {
        ...input,
        fps: 24,
      }),
  };
}
