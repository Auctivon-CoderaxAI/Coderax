/**
 * Reversible transport configuration for the WorkflowEngine gateway.
 *
 * The gateway is off unless `workflowEngine.enabled` is true, so rolling back is
 * one configuration change and a restart; no client state or stored data moves.
 * The engine credential is named, never stored: `tokenEnv` is a server variable
 * name and the value is read from the process environment at call time.
 */

export const DEFAULT_ENGINE_TOKEN_ENV = 'CODERAX_ENGINE_TOKEN';
export const DEFAULT_CONTRACT_VERSION = '1.0.0';
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 120_000;

export type WorkflowEngineGatewayOptions = {
  enabled?: boolean;
  baseURL?: string;
  /** The one Coderax user id allowed to use the owner's engine. */
  ownerUserId?: string;
  /** Conversations the migration may move to the engine on first dispatch. */
  conversations?: string[];
  /** Name of the server variable holding the owner token, not the token. */
  tokenEnv?: string;
  contractVersion?: string;
  requestTimeoutMs?: number;
  streamIdleTimeoutMs?: number;
  /** Runs the compatibility handshake at startup; request checks always run. */
  startupCheck?: boolean;
};

export type ResolvedGatewayConfig =
  | { enabled: false }
  | {
      enabled: true;
      baseURL: string;
      ownerUserId: string;
      conversations: readonly string[];
      token: string;
      tokenEnv: string;
      contractVersion: string;
      requestTimeoutMs: number;
      streamIdleTimeoutMs: number;
      startupCheck: boolean;
      /** Stable cache key; deliberately excludes the token value. */
      fingerprint: string;
    };

export type GatewayConfigFailure = {
  ok: false;
  code:
    | 'WORKFLOW_ENGINE_NOT_CONFIGURED'
    | 'WORKFLOW_ENGINE_INVALID_CONFIG'
    | 'WORKFLOW_ENGINE_OWNER_MISSING'
    | 'WORKFLOW_ENGINE_TOKEN_MISSING';
  /** User-safe; names a variable, never a value or a host path. */
  detail: string;
};

export type GatewayConfigResult = { ok: true; value: ResolvedGatewayConfig } | GatewayConfigFailure;

function positiveInteger(value: number | undefined, fallback: number): number | null {
  if (value == null) {
    return fallback;
  }
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function isLoopback(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

/**
 * The engine is authenticated with a bearer token, so plaintext HTTP is refused
 * everywhere except loopback, where a local development engine cannot
 * practically serve TLS.
 */
function parseBaseURL(value: string): { ok: true; url: URL } | { ok: false; detail: string } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, detail: 'workflowEngine.baseURL must be an absolute URL.' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, detail: 'workflowEngine.baseURL must use https, or http on loopback.' };
  }
  if (url.username || url.password) {
    return { ok: false, detail: 'workflowEngine.baseURL must not embed credentials.' };
  }
  if (url.search || url.hash) {
    return { ok: false, detail: 'workflowEngine.baseURL must not carry a query or fragment.' };
  }
  if (url.protocol === 'http:' && !isLoopback(url.hostname)) {
    return {
      ok: false,
      detail: 'workflowEngine.baseURL must use https unless it points at loopback.',
    };
  }
  return { ok: true, url };
}

export function resolveGatewayConfig(
  options: WorkflowEngineGatewayOptions | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): GatewayConfigResult {
  if (options?.enabled !== true) {
    return { ok: true, value: { enabled: false } };
  }
  if (options.baseURL == null || options.baseURL.trim().length === 0) {
    return {
      ok: false,
      code: 'WORKFLOW_ENGINE_NOT_CONFIGURED',
      detail: 'workflowEngine.baseURL is required when the gateway is enabled.',
    };
  }
  const parsed = parseBaseURL(options.baseURL.trim());
  if (!parsed.ok) {
    return { ok: false, code: 'WORKFLOW_ENGINE_INVALID_CONFIG', detail: parsed.detail };
  }
  const ownerUserId = (options.ownerUserId ?? '').trim();
  if (ownerUserId.length === 0) {
    return {
      ok: false,
      code: 'WORKFLOW_ENGINE_OWNER_MISSING',
      detail:
        'workflowEngine.ownerUserId must name the one Coderax user allowed to use the engine.',
    };
  }
  if (ownerUserId.length > 200 || /\s/.test(ownerUserId)) {
    return {
      ok: false,
      code: 'WORKFLOW_ENGINE_INVALID_CONFIG',
      detail: 'workflowEngine.ownerUserId must be a single user id without whitespace.',
    };
  }
  const rawConversations = options.conversations ?? [];
  if (!Array.isArray(rawConversations) || rawConversations.length > 500) {
    return {
      ok: false,
      code: 'WORKFLOW_ENGINE_INVALID_CONFIG',
      detail: 'workflowEngine.conversations must be a list of at most 500 conversation ids.',
    };
  }
  const conversations: string[] = [];
  for (const entry of rawConversations) {
    if (typeof entry !== 'string' || entry.trim().length === 0 || entry.trim().length > 200) {
      return {
        ok: false,
        code: 'WORKFLOW_ENGINE_INVALID_CONFIG',
        detail: 'workflowEngine.conversations must contain conversation ids only.',
      };
    }
    const id = entry.trim();
    if (!conversations.includes(id)) {
      conversations.push(id);
    }
  }
  const tokenEnv = (options.tokenEnv ?? DEFAULT_ENGINE_TOKEN_ENV).trim();
  if (!/^[A-Z][A-Z0-9_]{0,127}$/.test(tokenEnv)) {
    return {
      ok: false,
      code: 'WORKFLOW_ENGINE_INVALID_CONFIG',
      detail: 'workflowEngine.tokenEnv must be an uppercase environment variable name.',
    };
  }
  const token = env[tokenEnv];
  if (token == null || token.trim().length === 0) {
    return {
      ok: false,
      code: 'WORKFLOW_ENGINE_TOKEN_MISSING',
      detail: `${tokenEnv} is not set, so Coderax cannot authenticate to the WorkflowEngine.`,
    };
  }
  if (token.length > 4096) {
    return {
      ok: false,
      code: 'WORKFLOW_ENGINE_INVALID_CONFIG',
      detail: `${tokenEnv} is not a valid WorkflowEngine token.`,
    };
  }
  const requestTimeoutMs = positiveInteger(options.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS);
  const streamIdleTimeoutMs = positiveInteger(
    options.streamIdleTimeoutMs,
    DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  );
  if (requestTimeoutMs == null || streamIdleTimeoutMs == null) {
    return {
      ok: false,
      code: 'WORKFLOW_ENGINE_INVALID_CONFIG',
      detail: 'workflowEngine timeouts must be positive integers.',
    };
  }

  /**
   * The gateway validates against its compiled-in schemas. Accepting another
   * version here would make the handshake pass while every message is still
   * shaped as 1.0.0.
   */
  const contractVersion = (options.contractVersion ?? DEFAULT_CONTRACT_VERSION).trim();
  if (contractVersion !== DEFAULT_CONTRACT_VERSION) {
    return {
      ok: false,
      code: 'WORKFLOW_ENGINE_INVALID_CONFIG',
      detail: `workflowEngine.contractVersion must be ${DEFAULT_CONTRACT_VERSION}; this build implements only that contract.`,
    };
  }

  // A path prefix is preserved so a deployment can host the engine beside
  // other services without rewriting routes.
  const basePath = parsed.url.pathname.replace(/\/+$/, '');
  const baseURL = `${parsed.url.origin}${basePath}`;
  return {
    ok: true,
    value: {
      enabled: true,
      baseURL,
      ownerUserId,
      conversations,
      token,
      tokenEnv,
      contractVersion,
      requestTimeoutMs,
      streamIdleTimeoutMs,
      startupCheck: options.startupCheck !== false,
      fingerprint: `${baseURL}|${ownerUserId}|${conversations.join(',')}|${tokenEnv}|${contractVersion}|${requestTimeoutMs}|${streamIdleTimeoutMs}`,
    },
  };
}

/** Safe operator-facing description: no token, no hostname, no path. */
export function describeGatewayConfig(result: GatewayConfigResult): {
  enabled: boolean;
  configured: boolean;
  contractVersion: string;
  reason?: string;
} {
  if (!result.ok) {
    return {
      enabled: true,
      configured: false,
      contractVersion: DEFAULT_CONTRACT_VERSION,
      reason: result.code,
    };
  }
  if (!result.value.enabled) {
    return { enabled: false, configured: false, contractVersion: DEFAULT_CONTRACT_VERSION };
  }
  return {
    enabled: true,
    configured: true,
    contractVersion: result.value.contractVersion,
  };
}
