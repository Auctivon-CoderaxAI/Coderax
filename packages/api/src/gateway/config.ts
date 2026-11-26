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
export const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
export const DEFAULT_MAX_FRAME_BYTES = 1_048_576;
export const DEFAULT_MAX_EVENT_RESYNCS = 3;

export type WorkflowEngineGatewayOptions = {
  enabled?: boolean;
  baseURL?: string;
  /** Name of the server variable holding the owner token, not the token. */
  tokenEnv?: string;
  contractVersion?: string;
  requestTimeoutMs?: number;
  streamIdleTimeoutMs?: number;
  /** JSON response budget; an oversize body is refused before it is buffered. */
  maxResponseBytes?: number;
  /** SSE frame budget, measured in UTF-8 bytes. */
  maxFrameBytes?: number;
  /** Reconnects allowed without advancing the event cursor before failing closed. */
  maxEventResyncs?: number;
  /** Runs the compatibility and readiness handshake at startup; request checks always run. */
  startupCheck?: boolean;
};

export type ResolvedGatewayConfig =
  | { enabled: false }
  | {
      enabled: true;
      baseURL: string;
      token: string;
      tokenEnv: string;
      contractVersion: string;
      requestTimeoutMs: number;
      streamIdleTimeoutMs: number;
      maxResponseBytes: number;
      maxFrameBytes: number;
      maxEventResyncs: number;
      startupCheck: boolean;
      /** Stable cache key; deliberately excludes the token value. */
      fingerprint: string;
    };

export type GatewayConfigFailure = {
  ok: false;
  code:
    | 'WORKFLOW_ENGINE_NOT_CONFIGURED'
    | 'WORKFLOW_ENGINE_INVALID_CONFIG'
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

function nonNegativeInteger(value: number | undefined, fallback: number): number | null {
  if (value == null) {
    return fallback;
  }
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/**
 * The AppConfig the server loads for the gateway: YAML configuration under
 * `config`, with an optional root-level deployment override merged by the
 * config service.
 */
export type GatewayConfigSource = {
  config?: { workflowEngine?: WorkflowEngineGatewayOptions | null } | null;
  workflowEngine?: WorkflowEngineGatewayOptions | null;
};

/**
 * Resolve the effective gateway options from both layers.
 *
 * A root-level override is merged field by field over the YAML value, so a
 * partial override such as `{ enabled: false }` keeps the YAML `baseURL` and
 * every other transport setting. With no override the YAML value is returned
 * unchanged. The credential comes from the named server environment variable,
 * never from either configuration layer.
 */
export function resolveGatewayOptions(
  source: GatewayConfigSource | null | undefined,
): WorkflowEngineGatewayOptions | undefined {
  const base = source?.config?.workflowEngine;
  const override = source?.workflowEngine;
  if (base == null) {
    return override ?? undefined;
  }
  if (override == null) {
    return base;
  }
  return {
    ...base,
    ...(override.enabled === undefined ? {} : { enabled: override.enabled }),
    ...(override.baseURL === undefined ? {} : { baseURL: override.baseURL }),
    ...(override.tokenEnv === undefined ? {} : { tokenEnv: override.tokenEnv }),
    ...(override.contractVersion === undefined
      ? {}
      : { contractVersion: override.contractVersion }),
    ...(override.requestTimeoutMs === undefined
      ? {}
      : { requestTimeoutMs: override.requestTimeoutMs }),
    ...(override.streamIdleTimeoutMs === undefined
      ? {}
      : { streamIdleTimeoutMs: override.streamIdleTimeoutMs }),
    ...(override.maxResponseBytes === undefined
      ? {}
      : { maxResponseBytes: override.maxResponseBytes }),
    ...(override.maxFrameBytes === undefined ? {} : { maxFrameBytes: override.maxFrameBytes }),
    ...(override.maxEventResyncs === undefined
      ? {}
      : { maxEventResyncs: override.maxEventResyncs }),
    ...(override.startupCheck === undefined ? {} : { startupCheck: override.startupCheck }),
  };
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
  env: NodeJS.ProcessEnv,
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
  const maxResponseBytes = positiveInteger(options.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES);
  const maxFrameBytes = positiveInteger(options.maxFrameBytes, DEFAULT_MAX_FRAME_BYTES);
  const maxEventResyncs = nonNegativeInteger(options.maxEventResyncs, DEFAULT_MAX_EVENT_RESYNCS);
  if (
    requestTimeoutMs == null ||
    streamIdleTimeoutMs == null ||
    maxResponseBytes == null ||
    maxFrameBytes == null ||
    maxEventResyncs == null
  ) {
    return {
      ok: false,
      code: 'WORKFLOW_ENGINE_INVALID_CONFIG',
      detail:
        'workflowEngine timeouts and byte limits must be positive integers; resyncs may be zero.',
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
      token,
      tokenEnv,
      contractVersion,
      requestTimeoutMs,
      streamIdleTimeoutMs,
      maxResponseBytes,
      maxFrameBytes,
      maxEventResyncs,
      startupCheck: options.startupCheck !== false,
      fingerprint: `${baseURL}|${tokenEnv}|${contractVersion}|${requestTimeoutMs}|${streamIdleTimeoutMs}|${maxResponseBytes}|${maxFrameBytes}|${maxEventResyncs}`,
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
