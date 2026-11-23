import { isFullDeepSeekR1 } from 'coderax-data-provider';
import type { FreeEndpoint } from 'coderax-data-provider';

/**
 * A real, authenticated inference check for one endpoint.
 *
 * Verification is the only thing that may claim a provider works: a catalog
 * entry and a price page are evidence of the free terms, not proof that the
 * credential, model id and terms still line up. The probe sends a minimal
 * completion, validates the response shape, and returns a safe result that
 * carries no credential and no provider payload.
 */

export type FreeProbeErrorCode =
  | 'missing_credential'
  | 'missing_account'
  | 'unauthorized'
  | 'rate_limited'
  | 'timeout'
  | 'network_error'
  | 'provider_error'
  | 'invalid_response'
  | 'model_identity_mismatch';

export type FreeProbeResult = {
  endpointId: string;
  provider: string;
  modelId: string;
  ok: boolean;
  latencyMs: number;
  status: number | null;
  /** The model the provider reports having served, when it reports one. */
  modelEcho: string | null;
  errorCode: FreeProbeErrorCode | null;
};

type FetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

export type FreeFetch = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<FetchResponse>;

const PROBE_PROMPT = 'Reply with the single word OK.';
const PROBE_MAX_TOKENS = 64;

/** Substitute deployment values into an endpoint URL without keeping them anywhere. */
export function freeEndpointUrl(endpoint: FreeEndpoint, accountId?: string): string {
  const base = endpoint.baseURL.replace(/\$\{CLOUDFLARE_ACCOUNT_ID\}/g, accountId ?? '');
  if (endpoint.provider === 'cloudflare') {
    return `${base.replace(/\/$/, '')}/${endpoint.modelId}`;
  }
  return `${base.replace(/\/$/, '')}/chat/completions`;
}

function safeErrorCode(status: number): FreeProbeErrorCode {
  if (status === 401 || status === 403) {
    return 'unauthorized';
  }
  if (status === 429) {
    return 'rate_limited';
  }
  if (status >= 500) {
    return 'provider_error';
  }
  return 'invalid_response';
}

function readGeneratedText(payload: unknown, provider: string): string | null {
  if (payload == null || typeof payload !== 'object') {
    return null;
  }
  const body = payload as Record<string, unknown>;
  if (provider === 'cloudflare') {
    const result = body.result;
    if (result != null && typeof result === 'object') {
      const response = (result as Record<string, unknown>).response;
      return typeof response === 'string' && response.trim() !== '' ? response : null;
    }
    return null;
  }
  const choices = body.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }
  const first = choices[0];
  if (first == null || typeof first !== 'object') {
    return null;
  }
  const message = (first as Record<string, unknown>).message;
  if (message == null || typeof message !== 'object') {
    return null;
  }
  const fields = message as Record<string, unknown>;
  for (const field of ['content', 'reasoning', 'reasoning_content']) {
    const value = fields[field];
    if (typeof value === 'string' && value.trim() !== '') {
      return value;
    }
  }
  return null;
}

function readModelEcho(payload: unknown): string | null {
  if (payload == null || typeof payload !== 'object') {
    return null;
  }
  const model = (payload as Record<string, unknown>).model;
  return typeof model === 'string' ? model : null;
}

export async function probeFreeEndpoint({
  endpoint,
  apiKey,
  accountId,
  fetchImpl = globalThis.fetch as unknown as FreeFetch,
  timeoutMs = 60_000,
  now = Date.now,
}: {
  endpoint: FreeEndpoint;
  apiKey?: string | null;
  accountId?: string | null;
  fetchImpl?: FreeFetch;
  timeoutMs?: number;
  now?: () => number;
}): Promise<FreeProbeResult> {
  const startedAt = now();
  const base = {
    endpointId: endpoint.id,
    provider: endpoint.provider,
    modelId: endpoint.modelId,
    latencyMs: 0,
    status: null,
    modelEcho: null,
    errorCode: null,
  } as const;

  if (!apiKey) {
    return { ...base, ok: false, errorCode: 'missing_credential' };
  }
  if (endpoint.provider === 'cloudflare' && !accountId) {
    return { ...base, ok: false, errorCode: 'missing_account' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const body =
    endpoint.provider === 'cloudflare'
      ? JSON.stringify({
          messages: [{ role: 'user', content: PROBE_PROMPT }],
          max_tokens: PROBE_MAX_TOKENS,
        })
      : JSON.stringify({
          model: endpoint.modelId,
          messages: [{ role: 'user', content: PROBE_PROMPT }],
          max_tokens: PROBE_MAX_TOKENS,
          stream: false,
        });

  try {
    const response = await fetchImpl(freeEndpointUrl(endpoint, accountId ?? undefined), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body,
      signal: controller.signal,
    });
    const latencyMs = now() - startedAt;
    if (!response.ok) {
      return {
        ...base,
        ok: false,
        latencyMs,
        status: response.status,
        errorCode: safeErrorCode(response.status),
      };
    }
    const payload = await response.json();
    const content = readGeneratedText(payload, endpoint.provider);
    const modelEcho = readModelEcho(payload);
    if (!content) {
      return {
        ...base,
        ok: false,
        latencyMs,
        status: response.status,
        modelEcho,
        errorCode: 'invalid_response',
      };
    }
    if (endpoint.kind === 'primary' && modelEcho && !isFullDeepSeekR1(modelEcho)) {
      return {
        ...base,
        ok: false,
        latencyMs,
        status: response.status,
        modelEcho,
        errorCode: 'model_identity_mismatch',
      };
    }
    return {
      ...base,
      ok: true,
      latencyMs,
      status: response.status,
      modelEcho,
      errorCode: null,
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError';
    return {
      ...base,
      ok: false,
      latencyMs: now() - startedAt,
      errorCode: timedOut ? 'timeout' : 'network_error',
    };
  } finally {
    clearTimeout(timer);
  }
}
