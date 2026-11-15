export const EXIT = Object.freeze({
  OK: 0,
  ERROR: 1,
  USAGE: 2,
  UNAUTHENTICATED: 3,
  NETWORK: 4,
  NOT_FOUND: 5,
  UNAVAILABLE: 6,
  CANCELLED: 130,
});

export class CoderaxError extends Error {
  constructor(message, { code = EXIT.ERROR, status = null, hint = '' } = {}) {
    super(message);
    this.name = 'CoderaxError';
    this.code = code;
    this.status = status;
    this.hint = hint;
  }
}

export function usageError(message, hint = '') {
  return new CoderaxError(message, { code: EXIT.USAGE, hint });
}

/** Raised for products or features that are not implemented yet. */
export function unavailableError(message, hint = '') {
  return new CoderaxError(message, { code: EXIT.UNAVAILABLE, hint });
}

export class CoderaxClient {
  constructor({ baseUrl, token = '', fetchImpl, timeoutMs = 30_000 } = {}) {
    this.baseUrl = (baseUrl || '').replace(/\/+$/, '');
    this.token = token;
    this.fetchImpl = fetchImpl ?? globalThis.fetch;
    this.timeoutMs = timeoutMs;
  }

  requireBaseUrl() {
    if (!this.baseUrl) {
      throw new CoderaxError('No Coderax API base URL configured.', {
        code: EXIT.USAGE,
        hint: 'Set it with `coderax config set base-url https://your-deployment` or CODERAX_BASE_URL.',
      });
    }
  }

  headers(extra = {}) {
    const headers = { Accept: 'application/json', ...extra };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    return headers;
  }

  url(pathname) {
    this.requireBaseUrl();
    return `${this.baseUrl}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
  }

  async request(pathname, { method = 'GET', body, signal } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const response = await this.fetchImpl(this.url(pathname), {
        method,
        headers: this.headers(
          body ? { 'Content-Type': 'application/json' } : {},
        ),
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      return await this.#unwrap(response);
    } catch (error) {
      throw this.#normalise(error, signal);
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  /**
   * Streams a server-sent-event response, invoking `onEvent` per payload.
   * Returns the concatenated text once the stream ends.
   */
  async stream(pathname, { method = 'POST', body, signal, onEvent } = {}) {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const response = await this.fetchImpl(this.url(pathname), {
        method,
        headers: this.headers({
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        }),
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        await this.#unwrap(response);
        throw new CoderaxError('The server returned an empty stream.', {
          code: EXIT.ERROR,
        });
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let text = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        // SSE permits CRLF line endings. Normalise them after appending each
        // chunk so even a CRLF split across reads can terminate a frame.
        buffer = buffer.replace(/\r\n/g, '\n');

        let boundary = buffer.indexOf('\n\n');
        while (boundary !== -1) {
          const rawEvent = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const payload = parseSseEvent(rawEvent);
          if (payload !== null && payload !== undefined) {
            const delta = extractDelta(payload);
            if (delta) {
              text += delta;
              onEvent?.({ type: 'delta', text: delta, payload });
            } else {
              onEvent?.({ type: 'event', payload });
            }
            if (payload?.final === true || payload?.error) {
              onEvent?.({ type: 'final', payload });
              if (payload.error) {
                throw new CoderaxError(String(payload.error), {
                  code: EXIT.ERROR,
                });
              }
            }
          }
          boundary = buffer.indexOf('\n\n');
        }
      }

      return text;
    } catch (error) {
      throw this.#normalise(error, signal);
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  async #unwrap(response) {
    const raw = await response.text();
    let parsed = null;
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }
    }

    if (response.ok) {
      return parsed ?? raw;
    }

    const message =
      parsed?.error?.message
      || parsed?.message
      || raw.slice(0, 200)
      || `HTTP ${response.status}`;

    if (response.status === 401 || response.status === 403) {
      throw new CoderaxError(`Not authorised: ${message}`, {
        code: EXIT.UNAUTHENTICATED,
        status: response.status,
        hint: 'Run `coderax login` to store a token.',
      });
    }
    if (response.status === 404) {
      throw new CoderaxError(`Not found: ${message}`, {
        code: EXIT.NOT_FOUND,
        status: response.status,
      });
    }
    throw new CoderaxError(message, {
      code: EXIT.ERROR,
      status: response.status,
    });
  }

  #normalise(error, signal) {
    if (error instanceof CoderaxError) {
      return error;
    }
    if (error?.name === 'AbortError' || signal?.aborted) {
      return new CoderaxError('Cancelled.', { code: EXIT.CANCELLED });
    }
    return new CoderaxError(
      `Cannot reach ${this.baseUrl || 'the Coderax API'}: ${error?.message ?? error}`,
      { code: EXIT.NETWORK, hint: 'Check `coderax doctor` for connectivity.' },
    );
  }
}

function parseSseEvent(rawEvent) {
  const dataLines = rawEvent
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart());

  if (dataLines.length === 0) {
    return undefined;
  }
  const data = dataLines.join('\n');
  if (data === '[DONE]' || data === '') {
    return null;
  }
  try {
    return JSON.parse(data);
  } catch {
    return { text: data };
  }
}

/** Accepts the message shapes used by Coderax chat and agent endpoints. */
export function extractDelta(payload) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  if (typeof payload.text === 'string' && payload.message === true) {
    // Legacy ask endpoints resend the whole message; emit the tail only.
    return payload.delta ? String(payload.delta) : '';
  }
  const candidate =
    payload.delta
    ?? payload.token
    ?? payload.content
    ?? payload.choices?.[0]?.delta?.content;
  return typeof candidate === 'string' ? candidate : '';
}
