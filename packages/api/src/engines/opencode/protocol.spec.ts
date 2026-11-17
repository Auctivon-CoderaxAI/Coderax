import { OpenCodeEventMapper } from './protocol';

const sessionId = 'session-1';

const textPart = (id: string, text: string) => ({
  type: 'message.part.updated',
  properties: {
    sessionID: sessionId,
    time: 1,
    part: { id, sessionID: sessionId, messageID: 'm', type: 'text', text },
  },
});

describe('OpenCode event mapping', () => {
  it('emits only the new suffix of a cumulative text part', () => {
    const mapper = new OpenCodeEventMapper(sessionId);
    expect(mapper.map(textPart('p1', 'Hel'))).toEqual([{ type: 'text_delta', text: 'Hel' }]);
    expect(mapper.map(textPart('p1', 'Hello'))).toEqual([{ type: 'text_delta', text: 'lo' }]);
    expect(mapper.map(textPart('p1', 'Hello'))).toEqual([]);
  });

  it('maps a tool call and its result once', () => {
    const mapper = new OpenCodeEventMapper(sessionId);
    const part = (status: string, extra: Record<string, unknown>) => ({
      type: 'message.part.updated',
      properties: {
        sessionID: sessionId,
        part: {
          id: 'part-1',
          sessionID: sessionId,
          messageID: 'm',
          type: 'tool',
          callID: 'call-1',
          tool: 'bash',
          state: { status, input: { command: 'npm test' }, ...extra },
        },
      },
    });

    expect(mapper.map(part('pending', {}))).toEqual([
      { type: 'tool_call', callId: 'call-1', tool: 'bash', input: { command: 'npm test' } },
    ]);
    expect(mapper.map(part('running', {}))).toEqual([]);
    expect(mapper.map(part('completed', { output: 'ok' }))).toEqual([
      { type: 'tool_result', callId: 'call-1', tool: 'bash', ok: true, output: 'ok' },
    ]);
    expect(mapper.map(part('completed', { output: 'ok' }))).toEqual([]);
  });

  it('maps a failed tool result without leaking an exception', () => {
    const mapper = new OpenCodeEventMapper(sessionId);
    const events = mapper.map({
      type: 'message.part.updated',
      properties: {
        sessionID: sessionId,
        part: {
          id: 'p',
          sessionID: sessionId,
          messageID: 'm',
          type: 'tool',
          callID: 'call-2',
          tool: 'bash',
          state: { status: 'error', error: 'exit 1' },
        },
      },
    });
    expect(events).toEqual([
      { type: 'tool_result', callId: 'call-2', tool: 'bash', ok: false, output: 'exit 1' },
    ]);
  });

  it('deduplicates file edits and ignores other sessions', () => {
    const mapper = new OpenCodeEventMapper(sessionId);
    expect(mapper.map({ type: 'file.edited', properties: { file: 'src/sum.ts' } })).toEqual([
      { type: 'file_edit', path: 'src/sum.ts' },
    ]);
    expect(mapper.map({ type: 'file.edited', properties: { file: 'src/sum.ts' } })).toEqual([]);

    const other = new OpenCodeEventMapper(sessionId);
    expect(
      other.map({
        type: 'message.part.updated',
        properties: {
          sessionID: 'other',
          part: { id: 'x', sessionID: 'other', type: 'text', text: 'no' },
        },
      }),
    ).toEqual([]);
  });

  it('completes on session.idle and ignores malformed events', () => {
    const mapper = new OpenCodeEventMapper(sessionId);
    expect(mapper.map(null)).toEqual([]);
    expect(mapper.map({ type: 'unknown.event', properties: {} })).toEqual([]);
    expect(mapper.map({ type: 'session.idle', properties: { sessionID: sessionId } })).toEqual([
      { type: 'completed', sessionId },
    ]);
    expect(mapper.finished).toBe(true);
  });

  it('maps an abort to cancellation and never to success', () => {
    const mapper = new OpenCodeEventMapper(sessionId);
    expect(
      mapper.map({
        type: 'session.error',
        properties: {
          sessionID: sessionId,
          error: { name: 'MessageAbortedError' },
        },
      }),
    ).toEqual([{ type: 'cancelled', sessionId }]);
    expect(mapper.finished).toBe(true);
  });
});
