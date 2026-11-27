import type { EngineEvent, EngineRunHandle } from '../types';
import { startWithModelFallback } from './fallback';

type FakeHandle = EngineRunHandle & { cancel: jest.Mock; close: jest.Mock };

function fakeHandle(
  sessionId: string,
  events: EngineEvent[],
  options: { hang?: boolean } = {},
): FakeHandle {
  const cancel = jest.fn(async () => {});
  const close = jest.fn(async () => {});
  return {
    sessionId,
    events: (async function* () {
      for (const event of events) {
        yield event;
      }
      if (options.hang) {
        await new Promise<void>(() => undefined);
      }
    })(),
    cancel,
    close,
    result: new Promise(() => undefined) as EngineRunHandle['result'],
  };
}

async function collect(events: AsyncIterable<EngineEvent>): Promise<EngineEvent[]> {
  const seen: EngineEvent[] = [];
  for await (const event of events) {
    seen.push(event);
  }
  return seen;
}

describe('OpenCode model fallback', () => {
  it('retries the next verified free model after a provider refusal', async () => {
    const first = fakeHandle('ses-1', [
      { type: 'started', sessionId: 'ses-1' },
      { type: 'failed', sessionId: 'ses-1', code: 'provider_error' },
    ]);
    const second = fakeHandle('ses-2', [
      { type: 'started', sessionId: 'ses-2' },
      { type: 'text_delta', text: 'working' },
      { type: 'completed', sessionId: 'ses-2' },
    ]);

    const started = await startWithModelFallback({
      attempts: [
        async () => ({ ok: true, value: first }),
        async () => ({ ok: true, value: second }),
      ],
      firstEventTimeoutMs: 1_000,
    });

    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    expect(started.value.sessionId).toBe('ses-2');
    await expect(collect(started.value.events)).resolves.toEqual([
      { type: 'started', sessionId: 'ses-2' },
      { type: 'text_delta', text: 'working' },
      { type: 'completed', sessionId: 'ses-2' },
    ]);
    expect(first.cancel).toHaveBeenCalledTimes(1);
    expect(first.close).toHaveBeenCalledTimes(1);
  });

  it('never retries a run that already produced work', async () => {
    const first = fakeHandle('ses-1', [
      { type: 'started', sessionId: 'ses-1' },
      { type: 'tool_call', callId: 'c1', tool: 'bash' },
      { type: 'failed', sessionId: 'ses-1', code: 'provider_error' },
    ]);
    const secondAttempt = jest.fn(async () => ({
      ok: true as const,
      value: fakeHandle('ses-2', []),
    }));

    const started = await startWithModelFallback({
      attempts: [async () => ({ ok: true, value: first }), secondAttempt],
      firstEventTimeoutMs: 1_000,
    });

    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    const seen = await collect(started.value.events);
    expect(seen.map((event) => event.type)).toEqual(['started', 'tool_call', 'failed']);
    expect(secondAttempt).not.toHaveBeenCalled();
  });

  it('does not retry a failure that is not the model refusing', async () => {
    const secondAttempt = jest.fn(async () => ({
      ok: true as const,
      value: fakeHandle('ses-2', []),
    }));
    const started = await startWithModelFallback({
      attempts: [
        async () => ({
          ok: false as const,
          error: { code: 'server_unavailable' as const, message: 'down' },
        }),
        secondAttempt,
      ],
      firstEventTimeoutMs: 1_000,
    });

    expect(started).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: 'server_unavailable' }),
      }),
    );
    expect(secondAttempt).not.toHaveBeenCalled();
  });

  it('stops after the attempt bound and surfaces the final refusal to the caller', async () => {
    let attempts = 0;
    const refusal = async () => {
      attempts += 1;
      return {
        ok: true as const,
        value: fakeHandle(`ses-${attempts}`, [
          { type: 'started' as const, sessionId: `ses-${attempts}` },
          {
            type: 'failed' as const,
            sessionId: `ses-${attempts}`,
            code: 'provider_error' as const,
          },
        ]),
      };
    };
    const started = await startWithModelFallback({
      attempts: [refusal, refusal, refusal],
      firstEventTimeoutMs: 1_000,
    });

    // The bound is honoured exactly: three candidates were tried, and the last
    // attempt is returned so its own `failed` event and result reach the caller
    // instead of a fourth attempt or a fabricated start error.
    expect(attempts).toBe(3);
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    const seen = await collect(started.value.events);
    expect(seen).toEqual([
      { type: 'started', sessionId: 'ses-3' },
      { type: 'failed', sessionId: 'ses-3', code: 'provider_error' },
    ]);
  });

  it('cancels an in-flight first-event watch instead of retrying it', async () => {
    const controller = new AbortController();
    const hanging = fakeHandle('ses-hang', [{ type: 'started', sessionId: 'ses-hang' }], {
      hang: true,
    });
    const secondAttempt = jest.fn(async () => ({
      ok: true as const,
      value: fakeHandle('ses-2', []),
    }));

    const pending = startWithModelFallback({
      attempts: [async () => ({ ok: true, value: hanging }), secondAttempt],
      firstEventTimeoutMs: 10_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 10);
    const started = await pending;

    expect(started).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: 'cancelled' }),
      }),
    );
    expect(hanging.cancel).toHaveBeenCalledTimes(1);
    expect(hanging.close).toHaveBeenCalledTimes(1);
    expect(secondAttempt).not.toHaveBeenCalled();
  });

  it('commits a slow model instead of retrying it', async () => {
    const slow = fakeHandle('ses-slow', [{ type: 'started', sessionId: 'ses-slow' }], {
      hang: true,
    });
    const secondAttempt = jest.fn(async () => ({
      ok: true as const,
      value: fakeHandle('ses-2', []),
    }));

    const started = await startWithModelFallback({
      attempts: [async () => ({ ok: true, value: slow }), secondAttempt],
      firstEventTimeoutMs: 25,
    });

    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    expect(started.value.sessionId).toBe('ses-slow');
    expect(secondAttempt).not.toHaveBeenCalled();
    await started.value.close();
  });
});
