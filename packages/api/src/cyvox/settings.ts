import { PrincipalType } from 'coderax-data-provider';
import { BASE_CONFIG_PRINCIPAL_ID, logger } from '@coderax/data-schemas';
import type {
  TCyVoxConnectionStatus,
  TCyVoxConnectionTestResponse,
  TCyVoxConnectionTestErrorCode,
  TCyVoxProbeRecord,
} from 'coderax-data-provider';
import type { IConfig } from '@coderax/data-schemas';
import { resolveConfigSecret, getSecretPreview } from '~/admin/secrets';
import { readBoundedBody } from './response';

export type CyvoxEnvironment = {
  enabled: boolean;
  baseUrl?: string;
  authToken?: string;
};

export type StoredCyvoxConfig = {
  enabled?: boolean;
  baseUrl?: string;
  authToken?: string;
  authTokenPreview?: string;
  lastProbe?: TCyVoxProbeRecord;
};

export type CyvoxTarget = {
  url: URL;
  authToken?: string;
  source: 'settings' | 'environment';
};

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const VERIFICATION_TIMEOUT_MS = 10_000;
const MAX_CAPABILITIES = 50;
const MAX_CAPABILITY_LENGTH = 80;
const MAX_VERSION_LENGTH = 40;

function isLoopback(url: URL): boolean {
  return LOOPBACK_HOSTS.has(url.hostname);
}

/**
 * The CyVox origin is an origin only: credentials, a path, query or fragment
 * would let a mistyped value forward the bearer token somewhere unintended.
 * Remote targets must use HTTPS; a loopback desktop worker may use HTTP.
 */
export function normalizeCyvoxBaseUrl(raw: string): URL | null {
  try {
    const url = new URL(raw.trim());
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      return null;
    }
    if (isLoopback(url)) {
      return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
    }
    return url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

export function requiresAuthToken(url: URL): boolean {
  return !isLoopback(url);
}

export function readStoredCyvox(config: IConfig | null): StoredCyvoxConfig | undefined {
  const overrides = config?.overrides as { cyvox?: StoredCyvoxConfig } | null | undefined;
  return overrides?.cyvox;
}

export function readEnvironment(env: NodeJS.ProcessEnv = process.env): CyvoxEnvironment {
  const enabled = env.CYVOX_ADDON_ENABLED === 'true';
  const baseUrl = env.CYVOX_BASE_URL?.trim() || undefined;
  const authToken = env.CYVOX_AUTH_TOKEN?.trim() || undefined;
  return { enabled, baseUrl, authToken };
}

function resolveUrlAndToken(
  baseUrl: string,
  authToken: string | undefined,
): { url: URL; authToken?: string } | null {
  const url = normalizeCyvoxBaseUrl(baseUrl);
  if (!url) {
    return null;
  }
  const token = authToken?.trim() || undefined;
  if (!token && requiresAuthToken(url)) {
    return null;
  }
  return { url, authToken: token };
}

/**
 * A stored connection always wins over deployment environment variables, so an
 * administrator who disables the integration does not silently get the env
 * configuration back. Stored tokens are decrypted here; environment tokens are
 * already plain values.
 */
export function resolveCyvoxTarget(input: {
  stored?: StoredCyvoxConfig;
  environment: CyvoxEnvironment;
}): CyvoxTarget | null {
  const { stored, environment } = input;
  if (stored?.baseUrl) {
    if (stored.enabled !== true) {
      return null;
    }
    const resolved = resolveUrlAndToken(stored.baseUrl, resolveConfigSecret(stored.authToken));
    return resolved ? { ...resolved, source: 'settings' } : null;
  }
  if (!environment.enabled || !environment.baseUrl) {
    return null;
  }
  const resolved = resolveUrlAndToken(environment.baseUrl, environment.authToken);
  return resolved ? { ...resolved, source: 'environment' } : null;
}

export function buildCyvoxConnectionStatus(input: {
  stored?: StoredCyvoxConfig;
  environment: CyvoxEnvironment;
  updatedAt?: string;
}): TCyVoxConnectionStatus {
  const { stored, environment } = input;
  const fromSettings = Boolean(stored?.baseUrl);
  let source: 'settings' | 'environment' | 'none' = 'none';
  if (fromSettings) {
    source = 'settings';
  } else if (environment.baseUrl) {
    source = 'environment';
  }
  const url = normalizeCyvoxBaseUrl(
    fromSettings ? (stored?.baseUrl ?? '') : (environment.baseUrl ?? ''),
  );
  const tokenConfigured = fromSettings
    ? Boolean(resolveConfigSecret(stored?.authToken))
    : Boolean(environment.authToken);
  const configured =
    Boolean(url) && (Boolean(tokenConfigured) || (url != null && !requiresAuthToken(url)));
  const enabled = configured && (fromSettings ? stored?.enabled === true : environment.enabled);
  return {
    configured,
    enabled,
    source,
    baseUrl: url?.origin,
    tokenConfigured,
    tokenPreview: fromSettings ? stored?.authTokenPreview : undefined,
    updatedAt: input.updatedAt,
    lastProbe: fromSettings ? stored?.lastProbe : undefined,
  };
}

export type CyvoxStoredPreviewResult = {
  fields: Record<string, unknown>;
  preview: string;
};

/** Fields written when an administrator saves a connection, including the encrypted token. */
export function buildCyvoxUpdateFields(input: {
  enabled: boolean;
  baseUrl: string;
  authToken?: string;
}): CyvoxStoredPreviewResult | null {
  const url = normalizeCyvoxBaseUrl(input.baseUrl);
  if (!url) {
    return null;
  }
  const token = input.authToken?.trim();
  const fields: Record<string, unknown> = {
    'cyvox.enabled': input.enabled,
    'cyvox.baseUrl': url.origin,
  };
  if (!token) {
    return { fields, preview: '' };
  }
  fields['cyvox.authToken'] = token;
  fields['cyvox.authTokenPreview'] = getSecretPreview(token);
  return { fields, preview: getSecretPreview(token) };
}

function classifyStatus(status: number): TCyVoxConnectionTestErrorCode {
  if (status === 401) {
    return 'invalid_credentials';
  }
  if (status === 403) {
    return 'access_denied';
  }
  if (status === 404) {
    return 'invalid_endpoint';
  }
  if (status === 429) {
    return 'rate_limited';
  }
  if (status >= 500) {
    return 'server_error';
  }
  return 'unexpected_response';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * CyVox has reported capabilities as bare names, as objects with a name, and as
 * a nested item list. Accept all three, drop anything unreadable, and bound the
 * result: this reaches an administrator's screen and is persisted with the
 * connection, so an upstream cannot grow it without limit.
 */
export function parseCapabilities(payload: unknown): string[] {
  const root = asRecord(payload);
  if (!root) {
    return [];
  }
  const raw = root.capabilities ?? root.items;
  let entries: unknown[] = [];
  if (Array.isArray(raw)) {
    entries = raw;
  } else {
    const nested = asRecord(raw)?.items;
    if (Array.isArray(nested)) {
      entries = nested;
    }
  }
  const names = entries
    .map((entry) => {
      if (typeof entry === 'string') {
        return entry;
      }
      const record = asRecord(entry);
      const name = record?.name ?? record?.id;
      return typeof name === 'string' ? name : null;
    })
    .filter((name): name is string => name != null)
    .map((name) => name.trim().slice(0, MAX_CAPABILITY_LENGTH))
    .filter((name) => name.length > 0);
  return [...new Set(names)].slice(0, MAX_CAPABILITIES);
}

/** Version strings the service advertises, if it advertises one at all. */
export function parseApiVersion(payload: unknown): string | undefined {
  const root = asRecord(payload);
  if (!root) {
    return undefined;
  }
  const candidates = [
    root.api_version,
    root.apiVersion,
    root.version,
    asRecord(root.api)?.version,
    asRecord(root.build)?.version,
    asRecord(root.app)?.version,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim().slice(0, MAX_VERSION_LENGTH);
    }
  }
  return undefined;
}

type JsonRead =
  | { ok: true; body: unknown }
  | { ok: false; errorCode: TCyVoxConnectionTestErrorCode };

/** One bounded JSON read; the same guard the proxy applies to every upstream body. */
async function readJson(url: URL, headers: Record<string, string>): Promise<JsonRead> {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(VERIFICATION_TIMEOUT_MS),
    redirect: 'error',
  });
  if (!response.ok) {
    return { ok: false, errorCode: classifyStatus(response.status) };
  }
  if (!(response.headers.get('Content-Type') ?? '').includes('application/json')) {
    return { ok: false, errorCode: 'unexpected_response' };
  }
  const bounded = await readBoundedBody(response);
  if (!bounded.ok) {
    return { ok: false, errorCode: 'unexpected_response' };
  }
  try {
    return { ok: true, body: JSON.parse(bounded.body) };
  } catch {
    return { ok: false, errorCode: 'unexpected_response' };
  }
}

/**
 * A connection test reads CyVox's readiness summary, then — best effort — the
 * capability and status endpoints, so an administrator sees what the service
 * can actually do rather than only whether it answered. Capability discovery is
 * display-only: an older CyVox without those endpoints still passes the test.
 */
export async function verifyCyvoxEndpoint(
  target: CyvoxTarget,
): Promise<TCyVoxConnectionTestResponse> {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();
  const elapsed = () => Date.now() - startedAt;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (target.authToken) {
    headers.Authorization = `Bearer ${target.authToken}`;
  }
  try {
    const readiness = await readJson(new URL('/api/readiness', target.url), headers);
    if (!readiness.ok) {
      return { success: false, errorCode: readiness.errorCode, latencyMs: elapsed(), checkedAt };
    }
    const summaryValue = asRecord(readiness.body)?.summary;
    const summary = typeof summaryValue === 'string' ? summaryValue.slice(0, 300) : undefined;
    const [capabilityProbe, statusProbe] = await Promise.all([
      readJson(new URL('/api/kernel/capabilities', target.url), headers).catch(() => null),
      readJson(new URL('/api/system/status', target.url), headers).catch(() => null),
    ]);
    const capabilities = capabilityProbe?.ok ? parseCapabilities(capabilityProbe.body) : [];
    const apiVersion =
      (capabilityProbe?.ok ? parseApiVersion(capabilityProbe.body) : undefined) ??
      (statusProbe?.ok ? parseApiVersion(statusProbe.body) : undefined);
    return {
      success: true,
      ...(summary ? { summary } : {}),
      ...(capabilities.length > 0 ? { capabilities } : {}),
      ...(apiVersion ? { apiVersion } : {}),
      latencyMs: elapsed(),
      checkedAt,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      return { success: false, errorCode: 'timeout', latencyMs: elapsed(), checkedAt };
    }
    return { success: false, errorCode: 'unreachable', latencyMs: elapsed(), checkedAt };
  }
}

/** The persisted form of a check: outcome and capability summary, never the token. */
export function toProbeRecord(result: TCyVoxConnectionTestResponse): TCyVoxProbeRecord {
  const record: TCyVoxProbeRecord = {
    checkedAt: result.checkedAt ?? new Date().toISOString(),
    success: result.success,
  };
  if (!result.success) {
    record.errorCode = result.errorCode;
    return record;
  }
  if (result.capabilities?.length) {
    record.capabilities = result.capabilities;
  }
  if (result.apiVersion) {
    record.apiVersion = result.apiVersion;
  }
  return record;
}

export function buildProbeFields(record: TCyVoxProbeRecord): Record<string, unknown> {
  return { 'cyvox.lastProbe': record };
}

export type CyvoxTargetResolver = () => Promise<CyvoxTarget | null>;

export type CyvoxTargetResolverDeps = {
  findConfigByPrincipal: (
    principalType: PrincipalType,
    principalId: string,
  ) => Promise<IConfig | null>;
  environment?: CyvoxEnvironment;
  /** Overridable for tests; production reads the deployment environment. */
  readEnvironment?: () => CyvoxEnvironment;
};

/**
 * Resolves the effective integration per request so a saved connection takes
 * effect without a restart. A database failure degrades to "not configured",
 * which the routes report as unavailable rather than forwarding anywhere.
 */
export function createCyvoxTargetResolver(deps: CyvoxTargetResolverDeps): CyvoxTargetResolver {
  const environment = deps.environment ?? readEnvironment();
  return async () => {
    try {
      const config = await deps.findConfigByPrincipal(PrincipalType.ROLE, BASE_CONFIG_PRINCIPAL_ID);
      return resolveCyvoxTarget({ stored: readStoredCyvox(config), environment });
    } catch (error) {
      logger.warn('[cyvox] Failed to resolve stored connection', error);
      return null;
    }
  };
}
