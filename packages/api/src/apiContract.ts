/**
 * The WorkflowEngine client contract.
 *
 * A client reads this once from `/api/meta` instead of probing routes, so a
 * missing capability is a declared absence rather than a failed request. The
 * version is carried on every API response as `x-coderax-api-version`; a write
 * from a client that advertises a different major is refused before it runs.
 *
 * Bump `CODERAX_API_VERSION` only for a breaking change. Additive endpoints and
 * frame types stay on the same major and are announced through `capabilities`.
 */
export const CODERAX_API_VERSION = 1;

/** The oldest client this server will serve without a compatibility warning. */
export const CODERAX_MIN_CLIENT_VERSION = '0.1.0';

export const CODERAX_API_VERSION_HEADER = 'x-coderax-api-version';
export const CODERAX_CLIENT_VERSION_HEADER = 'x-coderax-client-version';

/**
 * The generation protocol the native agent SSE negotiates per stream. It is
 * advertised here so a client does not have to discover it from a response.
 */
export const CODERAX_GENERATION_PROTOCOL = 2;

export interface ApiWorkChatContract {
  /** Starts a turn. A retry is deduplicated by the idempotency key. */
  start: string;
  /** Reattaches to a live generation and replays its resume state. */
  resume: string;
  /** Every frame carries a monotonic `id:` field. */
  eventIds: boolean;
  /** Accepted retry keys, in precedence order. */
  idempotency: readonly string[];
}

export interface ApiWorkContract {
  tasks: { list: string; read: string; cancel: string };
  chat: ApiWorkChatContract;
}

export interface ApiWorkflowsContract {
  list: string;
  /** Owner-scoped run index; no workflow id is required. */
  runs: string;
  workflowRuns: string;
  runStream: {
    path: string;
    /** Durable event frames carry `id: <runId>:<seq>`. */
    eventIds: boolean;
    /** Reconnect with `Last-Event-ID` to replay only missed events. */
    resume: string;
  };
}

export interface ApiReposContract {
  /** Present and false: no inventory route is published, so no client probes one. */
  list: false;
  reason: string;
}

export interface ApiCapabilities {
  work: ApiWorkContract;
  workflows: ApiWorkflowsContract;
  repos: ApiReposContract;
}

export interface ApiContract {
  apiVersion: number;
  minimumClientVersion: string;
  generationProtocol: number;
  capabilities: ApiCapabilities;
}

export interface ApiMetadata extends ApiContract {
  name: string;
  /** Full deployed commit, when the deployment exports one. */
  commit: string | null;
  generatedAt: string;
}

export const CODERAX_API_CONTRACT: ApiContract = {
  apiVersion: CODERAX_API_VERSION,
  minimumClientVersion: CODERAX_MIN_CLIENT_VERSION,
  generationProtocol: CODERAX_GENERATION_PROTOCOL,
  capabilities: {
    work: {
      tasks: {
        list: '/api/work/tasks',
        read: '/api/work/tasks/:conversationId',
        cancel: '/api/work/tasks/:conversationId/cancel',
      },
      chat: {
        start: '/api/work/chat',
        resume: '/api/agents/chat/stream/:streamId',
        eventIds: true,
        idempotency: ['Idempotency-Key', 'body.clientRequestId'],
      },
    },
    workflows: {
      list: '/api/workflows',
      runs: '/api/workflows/runs',
      workflowRuns: '/api/workflows/:id/runs',
      runStream: {
        path: '/api/workflows/runs/:runId/stream',
        eventIds: true,
        resume: 'Last-Event-ID',
      },
    },
    repos: {
      list: false,
      reason:
        'No connected-repository inventory is published. Pass the repository on the run body instead.',
    },
  },
};

/** One document for `/api/meta`; the committed contract plus deployment facts. */
export function describeApiContract(
  options: { commit?: string | null; now?: Date } = {},
): ApiMetadata {
  return {
    name: 'coderax-workflow-api',
    ...CODERAX_API_CONTRACT,
    commit: options.commit ?? null,
    generatedAt: (options.now ?? new Date()).toISOString(),
  };
}

/**
 * The major of an advertised version. `1`, `1.4.2` and `1-beta` are all major
 * 1; anything that does not start with a number has no usable major.
 */
export function apiMajor(version: unknown): number | null {
  if (typeof version !== 'string' && typeof version !== 'number') {
    return null;
  }
  const raw = String(version).trim();
  const match = /^(\d+)/.exec(raw);
  if (match == null) {
    return null;
  }
  const major = Number(match[1]);
  return Number.isSafeInteger(major) ? major : null;
}

export function isSupportedApiVersion(version: unknown): boolean {
  return apiMajor(version) === CODERAX_API_VERSION;
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * A write from a client that advertises another major fails before it changes
 * anything. An absent version is a legacy client and stays accepted; a present
 * but unparseable one is refused because it cannot be negotiated.
 */
export function shouldRejectApiRequest(method: unknown, version: unknown): boolean {
  const raw =
    typeof version === 'string' || typeof version === 'number' ? String(version).trim() : '';
  if (raw.length === 0) {
    return false;
  }
  if (!MUTATING_METHODS.has(String(method ?? 'GET').toUpperCase())) {
    return false;
  }
  return !isSupportedApiVersion(raw);
}
