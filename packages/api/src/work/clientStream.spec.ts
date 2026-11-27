import type { NextFunction, Request, Response } from 'express';
import { applyEventIds, sseEventIds } from './clientStream';

interface FakeResponse {
  writes: unknown[];
  getHeader: () => string;
  write: (chunk: unknown) => boolean;
}

const createResponse = (contentType: string): FakeResponse => {
  const writes: unknown[] = [];
  return {
    writes,
    getHeader: () => contentType,
    write: (chunk: unknown) => {
      writes.push(chunk);
      return true;
    },
  };
};

const run = (res: FakeResponse): void => {
  sseEventIds()(
    {} as Request,
    res as unknown as Response,
    (() => undefined) as NextFunction,
  );
};

describe('applyEventIds', () => {
  it('adds a monotonic id to every frame in a write', () => {
    const state = { next: 1 };

    const chunk = 'event: message\ndata: {"a":1}\n\nevent: message\ndata: {"a":2}\n\n';

    expect(applyEventIds(chunk, state)).toBe(
      'event: message\nid: 1\ndata: {"a":1}\n\nevent: message\nid: 2\ndata: {"a":2}\n\n',
    );
    expect(state.next).toBe(3);
  });

  it('keeps an id the frame already carries and does not spend a counter on it', () => {
    const state = { next: 5 };

    expect(applyEventIds('event: snapshot\nid: run-1:9\ndata: {}\n\n', state)).toBe(
      'event: snapshot\nid: run-1:9\ndata: {}\n\n',
    );
    expect(state.next).toBe(5);
  });

  it('leaves a partial frame for the write that completes it', () => {
    const state = { next: 1 };

    expect(applyEventIds('event: message\ndata: {"a"', state)).toBe(
      'event: message\ndata: {"a"',
    );
    expect(state.next).toBe(1);
  });

  it('adds ids to complete frames and preserves the trailing partial one', () => {
    const state = { next: 1 };

    expect(applyEventIds('data: 1\n\ndata: 2\n\nevent: x', state)).toBe(
      'data: 1\nid: 1\n\ndata: 2\nid: 2\n\nevent: x',
    );
  });

  it('leaves a payload that is not a complete frame alone', () => {
    const state = { next: 1 };

    expect(applyEventIds('{"error":"nope"}', state)).toBe('{"error":"nope"}');
    expect(state.next).toBe(1);
  });
});

describe('sseEventIds middleware', () => {
  it('decorates frames only on an event stream', () => {
    const streamed = createResponse('text/event-stream');
    run(streamed);
    streamed.write('data: {"a":1}\n\n');

    const json = createResponse('application/json');
    run(json);
    json.write('{"a":1}');

    expect(streamed.writes).toEqual(['data: {"a":1}\nid: 1\n\n']);
    expect(json.writes).toEqual(['{"a":1}']);
  });

  it('keeps each response cursor independent', () => {
    const first = createResponse('text/event-stream');
    const second = createResponse('text/event-stream');
    run(first);
    run(second);

    first.write('data: 1\n\n');
    second.write('data: 1\n\n');

    expect(first.writes).toEqual(['data: 1\nid: 1\n\n']);
    expect(second.writes).toEqual(['data: 1\nid: 1\n\n']);
  });
});
