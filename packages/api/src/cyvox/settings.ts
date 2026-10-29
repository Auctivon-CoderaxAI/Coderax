import { PrincipalType } from 'coderax-data-provider';
import { BASE_CONFIG_PRINCIPAL_ID, logger } from '@coderax/data-schemas';
import type { TCyVoxConnectionStatus, TCyVoxConnectionTestResponse } from 'coderax-data-provider';
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
};

export type CyvoxTarget = {
  url: URL;
  authToken?: string;
  source: 'settings' | 'environment';
};

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const VERIFICATION_TIMEOUT_MS = 10_000;

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

function classifyStatus(status: number): TCyVoxConnectionTestResponse {
  if (status === 401) {
    return { success: false, errorCode: 'invalid_credentials' };
  }
  if (status === 403) {
    return { success: false, errorCode: 'access_denied' };
  }
  if (status === 404) {
    return { success: false, errorCode: 'invalid_endpoint' };
  }
  if (status === 429) {
    return { success: false, errorCode: 'rate_limited' };
  }
  if (status >= 500) {
    return { success: false, errorCode: 'server_error' };
  }
  return { success: false, errorCode: 'unexpected_response' };
}

/**
 * A connection test reads CyVox's readiness summary. It uses the same bounded
 * body reader as the proxy so a misbehaving upstream cannot stream an unbounded
 * response into the admin request.
 */
export async function verifyCyvoxEndpoint(
  target: CyvoxTarget,
): Promise<TCyVoxConnectionTestResponse> {
  try {
    const response = await fetch(new URL('/api/readiness', target.url), {
      headers: {
        Accept: 'application/json',
        ...(target.authToken ? { Authorization: `Bearer ${target.authToken}` } : {}),
      },
      signal: AbortSignal.timeout(VERIFICATION_TIMEOUT_MS),
      redirect: 'error',
    });
    if (!response.ok) {
      return classifyStatus(response.status);
    }
    if (!(response.headers.get('Content-Type') ?? '').includes('application/json')) {
      return { success: false, errorCode: 'unexpected_response' };
    }
    const bounded = await readBoundedBody(response);
    if (!bounded.ok) {
      return { success: false, errorCode: 'unexpected_response' };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(bounded.body);
    } catch {
      return { success: false, errorCode: 'unexpected_response' };
    }
    const summary =
      parsed != null &&
      typeof parsed === 'object' &&
      typeof (parsed as { summary?: unknown }).summary === 'string'
        ? (parsed as { summary: string }).summary.slice(0, 300)
        : undefined;
    return { success: true, ...(summary ? { summary } : {}) };
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      return { success: false, errorCode: 'timeout' };
    }
    return { success: false, errorCode: 'unreachable' };
  }
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
