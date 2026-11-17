import type {
  EngineEvent,
  EngineResult,
  EngineRunHandle,
  EngineRunSummary,
} from './types';
import { engineFailure } from './types';

/**
 * Shared run pump for every execution engine.
 *
 * It owns the one-settlement guarantee: a run resolves exactly once whether it
 * completes, fails, times out, is cancelled by the caller or loses its stream.
 * A stream that ends without a terminal event is a protocol failure, never a
 * success, so generated text alone can never be reported as completed work.
 */

class EventQueue {
  private readonly values: EngineEvent[] = [];
  private readonly waiters: Array<(value: IteratorResult<EngineEvent>) => void> = [];
  private closed = false;

  push(event: EngineEvent): void {
    if (this.closed) {
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value: event, done: false });
      return;
    }
    this.values.push(event);
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined, done: true });
    }
  }

  async *drain(): AsyncGenerator<EngineEvent> {
    for (;;) {
      const next = this.values.shift();
      if (next) {
        yield next;
        continue;
      }
      if (this.closed) {
        return;
      }
      const value = await new Promise<IteratorResult<EngineEvent>>((resolve) => {
        this.waiters.push(resolve);
      });
      if (value.done) {
        return;
      }
      yield value.value;
    }
  }
}

export type EngineRunPumpOptions = {
  sessionId: string;
  stream: AsyncIterable<unknown>;
  map: (raw: unknown) => EngineEvent[];
  /** Aborts engine-side work; must not throw. */
  cancelRun: () => Promise<void>;
  timeoutMs: number;
  maxSummaryChars: number;
  signal?: AbortSignal;
  /** Called once, after the result settles, so callers can release a lease. */
  onSettled?: () => void;
};

export function createEngineRunHandle(options: EngineRunPumpOptions): EngineRunHandle {
  const queue = new EventQueue();
  const iterator = options.stream[Symbol.asyncIterator]();
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let summaryText = '';
  let toolCalls = 0;
  let edits = 0;
  let usage: { inputTokens?: number; outputTokens?: number } | undefined;

  let resolveResult: (value: EngineResult<EngineRunSummary>) => void = () => {};
  const result = new Promise<EngineResult<EngineRunSummary>>((resolve) => {
    resolveResult = resolve;
  });

  const finish = (outcome: EngineResult<EngineRunSummary>, terminal?: EngineEvent): void => {
    if (settled) {
      return;
    }
    settled = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (terminal) {
      queue.push(terminal);
    }
    queue.close();
    resolveResult(outcome);
    options.onSettled?.();
  };

  const closeIterator = async (): Promise<void> => {
    try {
      await iterator.return?.();
    } catch {
      // The stream may already be closed.
    }
  };

  const cancel = async (): Promise<void> => {
    if (settled) {
      return;
    }
    // Settle before awaiting the engine: an iterator that closes during abort
    // must not be able to turn a caller's cancellation into a protocol error.
    finish(
      {
        ok: false,
        error: { code: 'cancelled', message: 'The run was cancelled.', retryable: false },
      },
      { type: 'cancelled', sessionId: options.sessionId },
    );
    await options.cancelRun();
    await closeIterator();
  };

  const summary = (): EngineRunSummary => ({
    sessionId: options.sessionId,
    toolCalls,
    edits,
    ...(usage ? { usage } : {}),
    ...(summaryText
      ? { summary: summaryText.slice(0, options.maxSummaryChars) }
      : {}),
  });

  const pump = async (): Promise<void> => {
    try {
      for (;;) {
        const next = await iterator.next();
        if (next.done) {
          break;
        }
        for (const event of options.map(next.value)) {
          if (event.type === 'text_delta') {
            summaryText += event.text;
          } else if (event.type === 'tool_call') {
            toolCalls += 1;
          } else if (event.type === 'file_edit') {
            edits += 1;
          } else if (event.type === 'usage') {
            usage = {
              ...(event.inputTokens !== undefined ? { inputTokens: event.inputTokens } : {}),
              ...(event.outputTokens !== undefined ? { outputTokens: event.outputTokens } : {}),
            };
          }

          queue.push(event);

          if (event.type === 'completed') {
            finish({ ok: true, value: summary() });
            return;
          }
          if (event.type === 'failed') {
            finish(engineFailure(event.code, event.message));
            return;
          }
          if (event.type === 'cancelled') {
            finish(
              {
                ok: false,
                error: {
                  code: 'cancelled',
                  message: 'The run was cancelled.',
                  retryable: false,
                },
              },
            );
            return;
          }
        }
      }
      finish(engineFailure('protocol_error', 'The engine stream ended before the run completed.'), {
        type: 'failed',
        sessionId: options.sessionId,
        code: 'protocol_error',
      });
    } catch {
      finish(engineFailure('provider_error', 'The engine event stream failed.'), {
        type: 'failed',
        sessionId: options.sessionId,
        code: 'provider_error',
      });
    }
  };

  timer = setTimeout(() => {
    if (settled) {
      return;
    }
    void (async () => {
      finish(
        {
          ok: false,
          error: { code: 'timeout', message: 'The run timed out.', retryable: true },
        },
        { type: 'failed', sessionId: options.sessionId, code: 'timeout' },
      );
      await options.cancelRun();
      await closeIterator();
    })();
  }, options.timeoutMs);

  if (options.signal) {
    if (options.signal.aborted) {
      void cancel();
    } else {
      options.signal.addEventListener('abort', () => void cancel(), { once: true });
    }
  }

  queue.push({ type: 'started', sessionId: options.sessionId });
  void pump();

  return {
    sessionId: options.sessionId,
    events: queue.drain(),
    cancel,
    result,
    close: async () => {
      await cancel();
      await closeIterator();
      queue.close();
    },
  };
}
