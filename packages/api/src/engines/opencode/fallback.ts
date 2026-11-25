import type { EngineEvent, EngineResult, EngineRunHandle } from '../types';

/**
 * Bounded model fallback for one task.
 *
 * OpenCode reports a provider refusal as a terminal `failed` event on the
 * session, after the prompt was accepted. A free hosted model can refuse for a
 * reason that has nothing to do with the task — an exhausted free quota, a
 * revoked key, a model retired from the catalog — so the only useful behavior is
 * to try the next verified $0 candidate and then stop.
 *
 * The fallback is deliberately narrow:
 *
 *  - only a `provider_error` failure retries, because it is the one outcome that
 *    names the model rather than the server or the task;
 *  - a run that already produced text, a tool call or a file edit is committed,
 *    so a partially streamed answer is never duplicated by a second model;
 *  - the first attempt is only watched until its first substantive event, and
 *    that watch is bounded, so a slow model is committed rather than retried;
 *  - every abandoned attempt is cancelled and closed before the next one starts,
 *    and the shared arbiter guarantees no two runs hold the task at once.
 */

/** Events that prove the model started doing the task. */
const COMMITTING: ReadonlySet<EngineEvent['type']> = new Set([
  'text_delta',
  'text_replace',
  'tool_call',
  'tool_result',
  'file_edit',
  'approval_required',
  'usage',
  'completed',
  'cancelled',
]);

const TIMED_OUT = Symbol('first-event-timeout');
const ABORTED = Symbol('cancelled');

function timeoutAfter(ms: number): Promise<typeof TIMED_OUT> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(TIMED_OUT), ms);
    if (typeof timer === 'object' && typeof timer.unref === 'function') {
      timer.unref();
    }
  });
}

/** Race an in-flight event read against the caller's cancellation. */
function abortWatcher(signal: AbortSignal | undefined): {
  promise: Promise<typeof ABORTED>;
  dispose: () => void;
} {
  if (!signal) {
    return { promise: new Promise<typeof ABORTED>(() => undefined), dispose: () => undefined };
  }
  if (signal.aborted) {
    return { promise: Promise.resolve(ABORTED), dispose: () => undefined };
  }
  let listener: (() => void) | undefined;
  const promise = new Promise<typeof ABORTED>((resolve) => {
    listener = () => resolve(ABORTED);
    signal.addEventListener('abort', listener, { once: true });
  });
  return {
    promise,
    dispose: () => {
      if (listener) {
        signal.removeEventListener('abort', listener);
      }
    },
  };
}

type PeekResult = {
  decision: 'commit' | 'retry' | 'cancel';
  buffered: EngineEvent[];
};

/**
 * Watch an attempt until it either proves it is working, fails with a provider
 * error, ends, or the watch deadline passes. Every event seen is returned so the
 * caller can replay it to the single consumer of the handle.
 */
async function peek(
  iterator: AsyncIterator<EngineEvent>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<PeekResult> {
  const buffered: EngineEvent[] = [];
  const deadline = Date.now() + timeoutMs;
  const abort = abortWatcher(signal);
  try {
    for (;;) {
      if (signal?.aborted) {
        return { decision: 'cancel', buffered };
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        return { decision: 'commit', buffered };
      }
      const next = await Promise.race([iterator.next(), timeoutAfter(remaining), abort.promise]);
      if (next === ABORTED) {
        return { decision: 'cancel', buffered };
      }
      if (next === TIMED_OUT) {
        return { decision: 'commit', buffered };
      }
      if (next.done) {
        // The pump surfaces a stream that ends without a terminal event as a
        // protocol failure; that is not a reason to try another model.
        return { decision: 'commit', buffered };
      }
      buffered.push(next.value);
      if (next.value.type === 'failed') {
        return {
          decision: next.value.code === 'provider_error' ? 'retry' : 'commit',
          buffered,
        };
      }
      if (COMMITTING.has(next.value.type)) {
        return { decision: 'commit', buffered };
      }
    }
  } finally {
    abort.dispose();
  }
}

function replay(
  iterator: AsyncIterator<EngineEvent>,
  buffered: EngineEvent[],
): AsyncIterable<EngineEvent> {
  return (async function* () {
    for (const event of buffered) {
      yield event;
    }
    for (;;) {
      const next = await iterator.next();
      if (next.done) {
        return;
      }
      yield next.value;
    }
  })();
}

export type ModelFallbackInput = {
  /** Ordered attempts; the last one's failure is reported as the run result. */
  attempts: Array<() => Promise<EngineResult<EngineRunHandle>>>;
  /** Bound on watching one attempt for its first substantive event. */
  firstEventTimeoutMs: number;
  /** Cancelling the request stops the attempt currently running. */
  signal?: AbortSignal;
};

/**
 * Start the first attempt that does not refuse on provider grounds.
 *
 * A failure that is not retryable (server unavailable, workspace denied,
 * timeout) is returned unchanged: retrying it on another model would only repeat
 * the same outcome.
 */
export async function startWithModelFallback(
  input: ModelFallbackInput,
): Promise<EngineResult<EngineRunHandle>> {
  let last: EngineResult<EngineRunHandle> | null = null;
  for (let index = 0; index < input.attempts.length; index += 1) {
    if (input.signal?.aborted) {
      return {
        ok: false,
        error: { code: 'cancelled', retryable: false, message: 'The run was cancelled.' },
      };
    }
    const attempt = input.attempts[index];
    const started = await attempt();
    if (!started.ok) {
      last = started;
      if (started.error.code !== 'provider_error') {
        return started;
      }
      continue;
    }

    const handle = started.value;
    const iterator = handle.events[Symbol.asyncIterator]();
    const seen = await peek(iterator, input.firstEventTimeoutMs, input.signal);
    if (seen.decision === 'cancel') {
      await handle.cancel().catch(() => undefined);
      await handle.close().catch(() => undefined);
      return {
        ok: false,
        error: { code: 'cancelled', retryable: false, message: 'The run was cancelled.' },
      };
    }
    if (seen.decision === 'commit' || index === input.attempts.length - 1) {
      return {
        ok: true,
        value: {
          sessionId: handle.sessionId,
          events: replay(iterator, seen.buffered),
          cancel: handle.cancel,
          result: handle.result,
          ...(handle.cleanup ? { cleanup: handle.cleanup } : {}),
          close: handle.close,
        },
      };
    }

    await iterator.return?.().catch(() => undefined);
    await handle.cancel().catch(() => undefined);
    await handle.close().catch(() => undefined);
    last = {
      ok: false,
      error: {
        code: 'provider_error',
        retryable: true,
        message: 'The model provider refused the run.',
      },
    };
  }

  return (
    last ?? {
      ok: false,
      error: {
        code: 'provider_error',
        retryable: false,
        message: 'No verified free model was available for this run.',
      },
    }
  );
}
