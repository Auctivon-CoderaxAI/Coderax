import {
  formatWorkflowRunStreamId,
  latestRunSequence,
  parseWorkflowRunStreamId,
  runEventSequence,
  sequenceRunEvents,
  toServerSentEventFrame,
} from './runStream';

describe('workflow run stream cursors', () => {
  it('round-trips a run cursor', () => {
    const id = formatWorkflowRunStreamId('9f1c2f7e-1b2a-4c3d-8e4f-5a6b7c8d9e0f', 12);

    expect(parseWorkflowRunStreamId(id)).toEqual({
      runId: '9f1c2f7e-1b2a-4c3d-8e4f-5a6b7c8d9e0f',
      sequence: 12,
    });
  });

  it('accepts a snapshot cursor at zero', () => {
    expect(parseWorkflowRunStreamId('run-1:0')).toEqual({ runId: 'run-1', sequence: 0 });
  });

  it('rejects a cursor it cannot apply', () => {
    expect(parseWorkflowRunStreamId(undefined)).toBeNull();
    expect(parseWorkflowRunStreamId('run-1')).toBeNull();
    expect(parseWorkflowRunStreamId(':4')).toBeNull();
    expect(parseWorkflowRunStreamId('run-1:')).toBeNull();
    expect(parseWorkflowRunStreamId('run-1:two')).toBeNull();
    expect(parseWorkflowRunStreamId('run-1:-1')).toBeNull();
  });

  it('delivers only the events a client has not acknowledged, in order', () => {
    const events = [{ seq: 1 }, { seq: 2 }, { seq: 3 }];

    expect(sequenceRunEvents(events, 0).map((entry) => entry.sequence)).toEqual([1, 2, 3]);
    expect(sequenceRunEvents(events, 2).map((entry) => entry.sequence)).toEqual([3]);
    expect(sequenceRunEvents(events, 3)).toEqual([]);
  });

  it('keeps sequence ids stable after the oldest events were truncated', () => {
    const retained = [{ seq: 198 }, { seq: 199 }, { seq: 200 }];

    expect(sequenceRunEvents(retained, 198).map((entry) => entry.sequence)).toEqual([199, 200]);
    expect(latestRunSequence(retained)).toBe(200);
  });

  it('falls back to a position for rows written before sequences were persisted', () => {
    expect(runEventSequence({}, 4)).toBe(5);
    expect(runEventSequence({ seq: 42 }, 0)).toBe(42);
    expect(latestRunSequence([{}, {}])).toBe(2);
    expect(latestRunSequence(undefined)).toBe(0);
  });

  it('serializes a frame with its event name, id and data', () => {
    expect(
      toServerSentEventFrame({ event: 'run-event', id: 'run-1:7', data: { sequence: 7 } }),
    ).toBe('event: run-event\nid: run-1:7\ndata: {"sequence":7}\n\n');
  });

  it('omits an event name or id that is not set', () => {
    expect(toServerSentEventFrame({ data: { run: 1 } })).toBe('data: {"run":1}\n\n');
  });
});
