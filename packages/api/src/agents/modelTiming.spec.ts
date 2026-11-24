import { MAX_MODEL_CALL_TIMINGS, createModelTimingTracker } from './modelTiming';

describe('createModelTimingTracker', () => {
  it('derives first-token, decode and throughput from observed timestamps', () => {
    const tracker = createModelTimingTracker();
    tracker.start('run', { anchor: 'model_start', observedAt: 1_000 });
    tracker.firstDelta('run', 13_000);
    tracker.firstDelta('run', 14_000);

    const timing = tracker.end(
      'run',
      { input_tokens: 1_120, output_tokens: 88, model: 'qwen3.5:4b', provider: 'ollama' },
      56_000,
    );

    expect(timing).toEqual({
      anchor: 'model_start',
      model: 'qwen3.5:4b',
      provider: 'ollama',
      firstTokenMs: 12_000,
      decodeMs: 43_000,
      promptTokens: 1_120,
      outputTokens: 88,
      outputTokensPerSecond: 2,
    });
  });

  it('keeps the first anchor so a later run step cannot overwrite the request start', () => {
    const tracker = createModelTimingTracker();
    tracker.start('run', { anchor: 'model_start', observedAt: 1_000 });
    tracker.start('run', { anchor: 'run_step', stepId: 'step_1', observedAt: 9_000 });
    tracker.firstDelta('run', 11_000);

    expect(tracker.end('run', null, 21_000)).toMatchObject({
      anchor: 'model_start',
      firstTokenMs: 10_000,
      decodeMs: 10_000,
    });
  });

  it('bounds decode but not first-token latency for a run-step anchor', () => {
    /** The SDK dispatches the message-creation step from the streaming handler,
     *  on the chunk that carries the call's first delta. */
    const tracker = createModelTimingTracker();
    tracker.start('run', { anchor: 'run_step', stepId: 'step_1', observedAt: 5_000 });
    tracker.firstDelta('run', 5_002);

    const timing = tracker.end('run', { output_tokens: 20 }, 9_000);
    expect(timing).toMatchObject({
      anchor: 'run_step',
      stepId: 'step_1',
      decodeMs: 3_998,
      outputTokensPerSecond: 5,
    });
    expect(timing).not.toHaveProperty('firstTokenMs');
  });

  it('never turns a run-step anchor into a near-zero first-token figure', () => {
    const tracker = createModelTimingTracker();
    tracker.start('run', { anchor: 'run_step', observedAt: 10_000 });
    tracker.firstDelta('run', 10_003);

    expect(tracker.end('run', { output_tokens: 88 }, 40_000)).not.toHaveProperty('firstTokenMs');
  });

  it('marks an anchor as late when a delta preceded it, suppressing first-token latency', () => {
    const tracker = createModelTimingTracker();
    tracker.firstDelta('run', 4_000);
    tracker.start('run', { anchor: 'model_start', observedAt: 9_000 });
    tracker.firstDelta('run', 9_500);

    const timing = tracker.end('run', { output_tokens: 12 }, 20_000);
    expect(timing).toMatchObject({ anchor: 'model_start', outputTokens: 12 });
    expect(timing).not.toHaveProperty('firstTokenMs');
    expect(timing).not.toHaveProperty('decodeMs');
  });

  it('does not carry an unanchored delta into a later window for the same key', () => {
    const tracker = createModelTimingTracker();
    tracker.firstDelta('run', 4_000);
    expect(tracker.end('run', { output_tokens: 1 }, 5_000)).toBeUndefined();

    tracker.start('run', { anchor: 'model_start', observedAt: 9_000 });
    tracker.firstDelta('run', 11_000);

    expect(tracker.end('run', null, 13_000)).toMatchObject({ firstTokenMs: 2_000 });
  });

  it('reports no timing for a call whose start was never observed', () => {
    const tracker = createModelTimingTracker();
    tracker.firstDelta('unknown', 5_000);

    expect(tracker.end('unknown', { output_tokens: 10 }, 9_000)).toBeUndefined();
    expect(tracker.take()).toEqual([]);
  });

  it('omits a first token that precedes the anchor instead of clamping it to zero', () => {
    const tracker = createModelTimingTracker();
    tracker.start('run', { anchor: 'model_start', observedAt: 10_000 });
    tracker.firstDelta('run', 9_000);

    const timing = tracker.end('run', { output_tokens: 10 }, 20_000);
    expect(timing).not.toHaveProperty('firstTokenMs');
    expect(timing).not.toHaveProperty('decodeMs');
    expect(timing).not.toHaveProperty('outputTokensPerSecond');
    expect(timing).toMatchObject({ outputTokens: 10 });
  });

  it('omits throughput when no token was decoded after the first delta', () => {
    const tracker = createModelTimingTracker();
    tracker.start('run', { anchor: 'model_start', observedAt: 1_000 });
    tracker.firstDelta('run', 2_000);

    expect(tracker.end('run', { output_tokens: 0 }, 2_000)).toMatchObject({ firstTokenMs: 1_000 });
    expect(tracker.end('run', { output_tokens: 0 }, 2_000)).toBeUndefined();
  });

  it('takes recorded timings once and bounds how many are retained', () => {
    const tracker = createModelTimingTracker();
    for (let i = 0; i < MAX_MODEL_CALL_TIMINGS + 3; i++) {
      tracker.start(`run-${i}`, { anchor: 'model_start', observedAt: 1_000 });
      tracker.firstDelta(`run-${i}`, 2_000);
      tracker.end(`run-${i}`, null, 3_000);
    }

    expect(tracker.take()).toHaveLength(MAX_MODEL_CALL_TIMINGS);
    expect(tracker.take()).toEqual([]);
  });
});
