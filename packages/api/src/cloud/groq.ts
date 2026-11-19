import type { DataMode } from '../engines/types';
import { scrubSecrets } from './redact';

/**
 * GroqCloud free-tier inference.
 *
 * Groq is an inference provider, not an execution engine: it never receives a
 * workspace, a tool definition or a private conversation. This module is the
 * only place that talks to Groq, and it fails closed:
 * - private mode is refused before any network call, at every path;
 * - a request needs an explicit owner approval bound to its exact content;
 * - only the allowlisted free model is accepted;
 * - the local daily budget is enforced before the call, and 429/402 stop the
 *   turn instead of retrying or falling back to a paid route;
 * - credentials stay in the server environment and never enter the body,
 *   response or status snapshot.
 */

export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
export const GROQ_FREE_MODEL = 'openai/gpt-oss-120b';

/** Published Free-plan ceilings for this model, read 2026-11-17. */
export const GROQ_FREE_LIMITS = {
  requestsPerMinute: 30,
  requestsPerDay: 1_000,
  tokensPerMinute: 8_000,
  tokensPerDay: 200_000,
} as const;

export type GroqFailureCode =
  | 'disabled'
  | 'missing_credential'
  | 'credential_rejected'
  | 'billing_tier_unattested'
  | 'private_mode_denied'
  | 'export_not_approved'
  | 'model_not_allowlisted'
  | 'tools_not_allowed'
  | 'quota_exhausted'
  | 'invalid_request'
  | 'provider_unavailable';

export type GroqFailure = {
  ok: false;
  error: {
    code: GroqFailureCode;
    message: string;
    retryable: boolean;
  };
};

export type GroqMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type GroqRequest = {
  mode: DataMode;
  /** Set only after `ModeBoundary.authorizeExport` accepted this payload. */
  approved: boolean;
  messages: readonly GroqMessage[];
  model?: string;
  estimatedTokens?: number;
  maxOutputTokens?: number;
  /** Execution tools are refused here; Groq performs inference only. */
  tools?: readonly unknown[];
};

export type GroqUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type GroqCompletion = {
  model: string;
  text: string;
  usage: GroqUsage;
};

export type GroqResult = { ok: true; value: GroqCompletion } | GroqFailure;

export type GroqConfig = {
  enabled: boolean;
  acknowledgeFreeTierOnly: boolean;
  model: string;
  maxRequestsPerDay: number;
  maxTokensPerDay: number;
  requestTimeoutMs: number;
};

export type GroqQuotaSnapshot = {
  date: string;
  requests: number;
  tokens: number;
  requestsRemaining: number;
  tokensRemaining: number;
};

export type GroqLedger = {
  reserve: (input: { requests: number; tokens: number }) => boolean;
  settle: (input: { reservedTokens: number; measuredTokens?: number }) => void;
  snapshot: () => GroqQuotaSnapshot;
};

const dayOf = (now: number): string => new Date(now).toISOString().slice(0, 10);

/**
 * Process-local daily ledger. It bounds this API process, not the whole
 * organisation: Groq's own 429 remains the final authority, and a 429 fails the
 * turn closed rather than opening a paid route.
 */
export function createMemoryGroqLedger(
  config: Pick<GroqConfig, 'maxRequestsPerDay' | 'maxTokensPerDay'>,
  now: () => number = Date.now,
): GroqLedger {
  const requestLimit = Math.max(
    1,
    Math.min(config.maxRequestsPerDay, GROQ_FREE_LIMITS.requestsPerDay),
  );
  const tokenLimit = Math.max(1, Math.min(config.maxTokensPerDay, GROQ_FREE_LIMITS.tokensPerDay));
  let date = dayOf(now());
  let requests = 0;
  let tokens = 0;

  const reset = (): void => {
    const today = dayOf(now());
    if (today !== date) {
      date = today;
      requests = 0;
      tokens = 0;
    }
  };

  return {
    reserve: ({ requests: requestCount, tokens: tokenCount }) => {
      reset();
      if (requests + requestCount > requestLimit) {
        return false;
      }
      if (tokens + tokenCount > tokenLimit) {
        return false;
      }
      requests += requestCount;
      tokens += tokenCount;
      return true;
    },
    settle: ({ reservedTokens, measuredTokens }) => {
      if (measuredTokens === undefined) {
        // Unknown usage keeps the reservation: the only safe direction.
        return;
      }
      tokens = Math.max(0, tokens + measuredTokens - reservedTokens);
    },
    snapshot: () => {
      reset();
      return {
        date,
        requests,
        tokens,
        requestsRemaining: Math.max(0, requestLimit - requests),
        tokensRemaining: Math.max(0, tokenLimit - tokens),
      };
    },
  };
}

export type GroqProviderOptions = {
  config: GroqConfig;
  env: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  ledger?: GroqLedger;
  now?: () => number;
};

export type GroqStatus = {
  enabled: boolean;
  provider: 'groq';
  model: string;
  freeTierOnly: boolean;
  credentialPresent: boolean;
  limits: typeof GROQ_FREE_LIMITS;
  quota: GroqQuotaSnapshot;
};

type Prepared =
  | { ok: true; messages: GroqMessage[]; estimatedTokens: number; maxOutputTokens: number }
  | GroqFailure;

function failure(code: GroqFailureCode, message: string, retryable = false): GroqFailure {
  return { ok: false, error: { code, message, retryable } };
}

function estimateTokens(messages: readonly GroqMessage[]): number {
  const chars = messages.reduce((total, message) => total + message.content.length, 0);
  return Math.max(16, Math.ceil(chars / 4));
}

function isGroqMessage(value: unknown): value is GroqMessage {
  if (value == null || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    (record.role === 'system' || record.role === 'user' || record.role === 'assistant') &&
    typeof record.content === 'string'
  );
}

function usageFields(raw: unknown): GroqUsage {
  if (raw == null || typeof raw !== 'object') {
    return {};
  }
  const usage = raw as Record<string, unknown>;
  const number = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  const inputTokens = number(usage.prompt_tokens);
  const outputTokens = number(usage.completion_tokens);
  const totalTokens = number(usage.total_tokens);
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
  };
}

/** Groq reports usage at the top level, and sometimes under x_groq.usage. */
function readUsage(raw: unknown): GroqUsage {
  if (raw == null || typeof raw !== 'object') {
    return {};
  }
  const record = raw as Record<string, unknown>;
  const nested = record.x_groq;
  return {
    ...usageFields(record.usage),
    ...(nested != null && typeof nested === 'object'
      ? usageFields((nested as Record<string, unknown>).usage)
      : {}),
  };
}

function hasUsage(usage: GroqUsage): boolean {
  return (
    usage.inputTokens !== undefined ||
    usage.outputTokens !== undefined ||
    usage.totalTokens !== undefined
  );
}

function providerErrorFrame(raw: unknown): boolean {
  if (raw == null || typeof raw !== 'object') {
    return false;
  }
  const xGroq = (raw as Record<string, unknown>).x_groq;
  if (xGroq == null || typeof xGroq !== 'object') {
    return false;
  }
  const error = (xGroq as Record<string, unknown>).error;
  return error !== null && error !== undefined;
}

function readStreamDelta(raw: unknown): string | null {
  if (raw == null || typeof raw !== 'object') {
    return null;
  }
  const choices = (raw as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }
  const first = choices[0];
  if (first == null || typeof first !== 'object') {
    return null;
  }
  const delta = (first as Record<string, unknown>).delta;
  if (delta == null || typeof delta !== 'object') {
    return null;
  }
  const content = (delta as Record<string, unknown>).content;
  return typeof content === 'string' ? content : null;
}

function readCompletionText(raw: unknown): string | null {
  if (raw == null || typeof raw !== 'object') {
    return null;
  }
  const choices = (raw as Record<string, unknown>).choices;
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
  const content = (message as Record<string, unknown>).content;
  return typeof content === 'string' ? content : null;
}

export type GroqProviderApi = {
  complete: (request: GroqRequest) => Promise<GroqResult>;
  stream: (request: GroqRequest, onDelta: (text: string) => void) => Promise<GroqResult>;
  status: () => GroqStatus;
};

export function createGroqProvider(options: GroqProviderOptions): GroqProviderApi {
  const { config, env } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const ledger = options.ledger ?? createMemoryGroqLedger(config, options.now ?? Date.now);

  function preflight(request: GroqRequest): Prepared {
    if (!config.enabled) {
      return failure('disabled', 'Cloud Power Mode is disabled.');
    }
    if (!env.GROQ_API_KEY) {
      return failure('missing_credential', 'GROQ_API_KEY is not set on the server.');
    }
    if (!config.acknowledgeFreeTierOnly) {
      return failure(
        'billing_tier_unattested',
        'The owner has not attested that this Groq organisation is on the Free plan.',
      );
    }
    if (request.mode !== 'cloud') {
      // This is the hard boundary: private mode never reaches the network.
      return failure(
        'private_mode_denied',
        'Private Mode content cannot be sent to an external inference provider.',
      );
    }
    if (!request.approved) {
      return failure(
        'export_not_approved',
        'This content has not been approved for Cloud Power Mode.',
      );
    }
    if (request.tools && request.tools.length > 0) {
      return failure('tools_not_allowed', 'Groq performs inference only; tools are not sent.');
    }
    const requestedModel = request.model ?? config.model;
    if (requestedModel !== GROQ_FREE_MODEL || config.model !== GROQ_FREE_MODEL) {
      return failure(
        'model_not_allowlisted',
        `Only ${GROQ_FREE_MODEL} is available on the free plan.`,
      );
    }
    if (request.messages.length === 0 || !request.messages.every(isGroqMessage)) {
      return failure('invalid_request', 'A message with a supported role is required.');
    }
    if (request.estimatedTokens !== undefined && !Number.isFinite(request.estimatedTokens)) {
      return failure('invalid_request', 'estimatedTokens must be a finite number.');
    }
    if (request.maxOutputTokens !== undefined && !Number.isFinite(request.maxOutputTokens)) {
      return failure('invalid_request', 'maxOutputTokens must be a finite number.');
    }

    const scrubbed = request.messages.map((message) => ({
      role: message.role,
      content: scrubSecrets(message.content, { env }).text,
    }));
    const estimatedTokens = Math.max(
      estimateTokens(scrubbed),
      Math.min(request.estimatedTokens ?? 0, GROQ_FREE_LIMITS.tokensPerDay),
    );
    const maxOutputTokens = Math.max(1, Math.min(request.maxOutputTokens ?? 1_024, 4_096));
    return { ok: true, messages: scrubbed, estimatedTokens, maxOutputTokens };
  }

  function headerObject(): Record<string, string> {
    return {
      Authorization: `Bearer ${env.GROQ_API_KEY ?? ''}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  function settle(reservedTokens: number, usage: GroqUsage): void {
    ledger.settle({
      reservedTokens,
      ...(usage.totalTokens !== undefined ? { measuredTokens: usage.totalTokens } : {}),
    });
  }

  type SendResult = { ok: true; response: Response } | GroqFailure;

  async function send(
    prepared: Extract<Prepared, { ok: true }>,
    stream: boolean,
  ): Promise<SendResult> {
    try {
      const response = await fetchImpl(`${GROQ_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: headerObject(),
        body: JSON.stringify({
          model: GROQ_FREE_MODEL,
          messages: prepared.messages,
          max_tokens: prepared.maxOutputTokens,
          stream,
          // No tools, no tool choice, no private context.
        }),
        signal: AbortSignal.timeout(config.requestTimeoutMs),
      });
      return { ok: true, response };
    } catch {
      return failure('provider_unavailable', 'The Groq request failed before a response.', true);
    }
  }

  function statusFailure(response: Response): GroqFailure | null {
    if (response.ok) {
      return null;
    }
    if (response.status === 429 || response.status === 402) {
      return failure(
        'quota_exhausted',
        'The Groq free-tier quota is exhausted; the turn stopped without a paid fallback.',
      );
    }
    if (response.status === 401 || response.status === 403) {
      return failure('credential_rejected', 'Groq rejected the server credential.');
    }
    if (response.status === 400 || response.status === 422) {
      return failure('invalid_request', 'Groq rejected the request shape.');
    }
    return failure('provider_unavailable', 'Groq is temporarily unavailable.', true);
  }

  async function complete(request: GroqRequest): Promise<GroqResult> {
    const prepared = preflight(request);
    if (!prepared.ok) {
      return prepared;
    }
    const reservedTokens = prepared.estimatedTokens + prepared.maxOutputTokens;
    if (!ledger.reserve({ requests: 1, tokens: reservedTokens })) {
      return failure(
        'quota_exhausted',
        'The local daily free-tier budget is exhausted; no request was sent.',
      );
    }

    const sent = await send(prepared, false);
    if (!sent.ok) {
      return sent;
    }
    const response = sent.response;
    const rejected = statusFailure(response);
    if (rejected) {
      return rejected;
    }

    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      return failure('provider_unavailable', 'Groq returned an unreadable response.', true);
    }
    const text = readCompletionText(raw);
    const usage = readUsage(raw);
    settle(reservedTokens, usage);
    if (text === null || text.trim() === '') {
      return failure('invalid_request', 'Groq returned no completion text.');
    }
    return {
      ok: true,
      value: { model: GROQ_FREE_MODEL, text, usage },
    };
  }

  /**
   * Streaming path. The response is still one allowance charge; every chunk is
   * passed to the caller as it arrives, and an exhausted quota never falls back.
   */
  async function stream(
    request: GroqRequest,
    onDelta: (text: string) => void,
  ): Promise<GroqResult> {
    const prepared = preflight(request);
    if (!prepared.ok) {
      return prepared;
    }
    const reservedTokens = prepared.estimatedTokens + prepared.maxOutputTokens;
    if (!ledger.reserve({ requests: 1, tokens: reservedTokens })) {
      return failure(
        'quota_exhausted',
        'The local daily free-tier budget is exhausted; no request was sent.',
      );
    }
    const sent = await send(prepared, true);
    if (!sent.ok) {
      return sent;
    }
    const response = sent.response;
    const rejected = statusFailure(response);
    if (rejected) {
      return rejected;
    }
    const body = response.body;
    if (!body) {
      return failure('provider_unavailable', 'Groq returned no stream body.', true);
    }

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    let usage: GroqUsage = {};
    let terminated = false;
    let streamError = false;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) {
          break;
        }
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) {
            continue;
          }
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') {
            terminated = true;
            continue;
          }
          let parsed: unknown;
          try {
            parsed = JSON.parse(data);
          } catch {
            continue;
          }
          const delta = readStreamDelta(parsed);
          if (delta) {
            text += delta;
            onDelta(delta);
          }
          const measured = readUsage(parsed);
          if (hasUsage(measured)) {
            usage = measured;
          }
          if (providerErrorFrame(parsed)) {
            streamError = true;
          }
        }
      }
    } catch {
      settle(reservedTokens, usage);
      return failure('provider_unavailable', 'The Groq stream failed.', true);
    } finally {
      reader.releaseLock();
    }

    settle(reservedTokens, usage);
    if (streamError) {
      return failure('provider_unavailable', 'Groq stopped the stream with an error.', true);
    }
    if (!terminated) {
      return failure('provider_unavailable', 'The Groq stream ended before it completed.', true);
    }
    if (text.trim() === '') {
      return failure('invalid_request', 'Groq returned no completion text.');
    }
    return { ok: true, value: { model: GROQ_FREE_MODEL, text, usage } };
  }

  function status(): GroqStatus {
    return {
      enabled: config.enabled,
      provider: 'groq',
      model: config.model,
      freeTierOnly: config.acknowledgeFreeTierOnly,
      credentialPresent: Boolean(env.GROQ_API_KEY),
      limits: GROQ_FREE_LIMITS,
      quota: ledger.snapshot(),
    };
  }

  return { complete, stream, status };
}

export type GroqProvider = GroqProviderApi;
