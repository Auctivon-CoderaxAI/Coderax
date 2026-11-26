import type { EngineOperation } from './contracts';
import type { GatewayResult } from './errors';
import { fail, gatewayError, fromEngineProblem, ok } from './errors';
import { Problem } from './contracts';

/**
 * The one HTTP transport to the WorkflowEngine.
 *
 * The credential is supplied by the caller (server-side only), never placed in a
 * URL, never logged, never echoed in an error. Redirects are refused so a
 * compromised endpoint cannot move the bearer token to another origin. Timeouts
 * bound every non-streaming call; a caller abort (client disconnect) cancels the
 * upstream request instead of leaving it running.
 */

export type EngineJsonResponse = { kind: 'json'; status: number; body: unknown };
export type EngineStreamResponse = {
  kind: 'stream';
  status: number;
  frames: AsyncIterable<string>;
};
export type EngineResponse = EngineJsonResponse | EngineStreamResponse;

export type EngineCall = {
  operation: EngineOperation;
  path: string;
  method: 'GET' | 'POST';
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** Set only for operations whose contract declares an SSE response. */
  stream?: boolean;
  signal?: AbortSignal;
};

export type EngineHttpClient = {
  call: (input: EngineCall) => Promise<GatewayResult<EngineResponse>>;
};

export type HttpClientOptions = {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

const MAX_ERROR_BYTES = 8_192;

function buildUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string | number | undefined>,
): string {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const base = new URL(normalizedBase);
  const url = new URL(path.replace(/^\/+/, ''), base);
  if (url.origin !== base.origin) {
    throw new Error('gateway path resolves outside the configured engine origin');
  }
  if (!url.pathname.startsWith(base.pathname)) {
    throw new Error('gateway path resolves outside the configured engine base path');
  }
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

type Timeout = { signal: AbortSignal; cancel: () => void };

function withTimeout(parent: AbortSignal | undefined, timeoutMs: number): Timeout {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (parent != null) {
    if (parent.aborted) {
      controller.abort();
    } else {
      parent.addEventListener('abort', abort, { once: true });
    }
  }
  const timer = setTimeout(abort, timeoutMs);
  timer.unref?.();

  return {
    signal: controller.signal,
    cancel: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', abort);
    },
  };
}

/** Parses SSE `data:` frames from an engine response body. */
export async function* readSseData(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      for (;;) {
        const boundary = buffer.indexOf('\n\n');
        if (boundary === -1) break;
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = frame
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (data.length > 0) {
          yield data;
        }
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The stream is already closed; releasing is best-effort.
    }
  }
}

export function createHttpEngineClient(options: HttpClientOptions): EngineHttpClient {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  return {
    call: async (input) => {
      if (typeof fetchImpl !== 'function') {
        return fail(gatewayError('engine_not_configured', { detail: 'fetch is unavailable' }));
      }

      let url: string;
      try {
        url = buildUrl(options.baseUrl, input.path, input.query);
      } catch {
        return fail(
          gatewayError('internal_error', { detail: 'the gateway route could not be resolved' }),
        );
      }

      const timeout = withTimeout(input.signal, timeoutMs);
      try {
        const response = await fetchImpl(url, {
          method: input.method,
          headers: {
            accept: input.stream ? 'text/event-stream' : 'application/json',
            authorization: `Bearer ${options.token}`,
            ...(input.body === undefined ? {} : { 'content-type': 'application/json' }),
          },
          ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
          redirect: 'error',
          signal: timeout.signal,
        });

        if (!response.ok) {
          return fail(await readProblem(response));
        }

        const contentType = response.headers.get('content-type') ?? '';
        if (input.stream && contentType.includes('text/event-stream')) {
          if (response.body == null) {
            return fail(
              gatewayError('contract_mismatch', {
                detail: 'the engine streamed no body for a streaming operation',
              }),
            );
          }
          return ok({
            kind: 'stream',
            status: response.status,
            frames: readSseData(response.body),
          });
        }

        const text = await response.text();
        let body: unknown;
        try {
          body = text.trim().length === 0 ? null : JSON.parse(text);
        } catch {
          return fail(
            gatewayError('contract_mismatch', {
              detail: 'the engine answered with a non-JSON success body',
              retryable: false,
            }),
          );
        }
        return ok({ kind: 'json', status: response.status, body });
      } catch (error) {
        if (input.signal?.aborted) {
          return fail(
            gatewayError('cancelled', { detail: 'the request was cancelled by the client' }),
          );
        }
        if (isAbort(error)) {
          return fail(
            gatewayError('upstream_unavailable', {
              detail: 'the WorkflowEngine did not answer before the gateway timeout',
              retryable: true,
            }),
          );
        }
        return fail(
          gatewayError('upstream_unavailable', { detail: 'the WorkflowEngine is unreachable' }),
        );
      } finally {
        timeout.cancel();
      }
    },
  };
}

function isAbort(error: unknown): boolean {
  return (
    error != null &&
    typeof error === 'object' &&
    ((error as { name?: unknown }).name === 'AbortError' ||
      (error as { name?: unknown }).name === 'TimeoutError')
  );
}

/**
 * Reads an engine failure. Only a well-formed `Problem` is trusted; anything else
 * becomes a generic upstream failure so an HTML error page or a proxy message is
 * never parsed as a contract.
 */
async function readProblem(response: Response): Promise<ReturnType<typeof gatewayError>> {
  let text = '';
  try {
    text = (await response.text()).slice(0, MAX_ERROR_BYTES);
  } catch {
    text = '';
  }

  let json: unknown = null;
  if (text.trim().length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  const parsed = Problem.safeParse(json);
  if (parsed.success) {
    return fromEngineProblem(parsed.data);
  }

  return gatewayError('upstream_unavailable', {
    detail: `the WorkflowEngine answered HTTP ${response.status} without a contract problem`,
  });
}
