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

  it('never echoes the prompt the user sent back as assistant text', () => {
    /* OpenCode streams parts for every message in the session. Mapping a user
     * text part as reply text made Work answer with its own prompt instead of
     * the engine's output, which looked like fabricated text. */
    const mapper = new OpenCodeEventMapper(sessionId);
    const message = (id: string, role: string) => ({
      type: 'message.updated',
      properties: { sessionID: sessionId, info: { id, sessionID: sessionId, role } },
    });
    const part = (id: string, messageID: string, text: string) => ({
      type: 'message.part.updated',
      properties: {
        sessionID: sessionId,
        part: { id, sessionID: sessionId, messageID, type: 'text', text },
      },
    });

    mapper.map(message('m-user', 'user'));
    mapper.map(message('m-assistant', 'assistant'));

    const prompt =
      'Earlier in this Work conversation:\nUser: hi\n\nCurrent request:\nhead -c 16 /dev/urandom';
    expect(mapper.map(part('p-user', 'm-user', prompt))).toEqual([]);
    expect(
      mapper.map({
        type: 'message.part.delta',
        properties: { sessionID: sessionId, partID: 'p-user', delta: ' tail' },
      }),
    ).toEqual([]);

    expect(mapper.map(part('p-assistant', 'm-assistant', '2a6b0392'))).toEqual([
      { type: 'text_delta', text: '2a6b0392' },
    ]);
    expect(mapper.map(part('p-assistant', 'm-assistant', '2a6b0392 done'))).toEqual([
      { type: 'text_delta', text: ' done' },
    ]);
  });

  it('emits a full snapshot when cumulative text replaces earlier text', () => {
    const mapper = new OpenCodeEventMapper(sessionId);
    expect(mapper.map(textPart('p1', 'Hello'))).toEqual([{ type: 'text_delta', text: 'Hello' }]);
    expect(mapper.map(textPart('p1', 'Help'))).toEqual([{ type: 'text_replace', text: 'Help' }]);
    expect(mapper.map(textPart('p1', 'Help!'))).toEqual([{ type: 'text_delta', text: '!' }]);
  });

  it('reconciles delta and cumulative text without duplicating a character', () => {
    const mapper = new OpenCodeEventMapper(sessionId);
    const delta = (text: string) => ({
      type: 'message.part.delta',
      properties: { sessionID: sessionId, partID: 'p1', delta: text },
    });

    expect(mapper.map(textPart('p1', 'Hel'))).toEqual([{ type: 'text_delta', text: 'Hel' }]);
    expect(mapper.map(delta('lo'))).toEqual([{ type: 'text_delta', text: 'lo' }]);
    expect(mapper.map(textPart('p1', 'Hello'))).toEqual([]);
    expect(mapper.map(delta('!'))).toEqual([{ type: 'text_delta', text: '!' }]);
    expect(mapper.map(textPart('p1', 'Hello!'))).toEqual([]);
  });

  const toolPart = (input: unknown, status: string, extra: Record<string, unknown> = {}) => ({
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
        state: { status, input, ...extra },
      },
    },
  });

  it('publishes a tool call once its real arguments arrive', () => {
    /* The `pending` state reports `input: {}`, so publishing there produced a
     * tool call with no arguments that later states never corrected. */
    const mapper = new OpenCodeEventMapper(sessionId);
    expect(mapper.map(toolPart({}, 'pending'))).toEqual([]);
    expect(mapper.map(toolPart({ command: 'npm test' }, 'running'))).toEqual([
      { type: 'tool_call', callId: 'call-1', tool: 'bash', input: { command: 'npm test' } },
    ]);
    expect(mapper.map(toolPart({ command: 'npm test' }, 'completed', { output: 'ok' }))).toEqual([
      { type: 'tool_result', callId: 'call-1', tool: 'bash', ok: true, output: 'ok' },
    ]);
    expect(mapper.map(toolPart({ command: 'npm test' }, 'completed', { output: 'ok' }))).toEqual(
      [],
    );
  });

  it('carries arguments a call reports before it starts running', () => {
    const mapper = new OpenCodeEventMapper(sessionId);
    expect(mapper.map(toolPart({ command: 'ls' }, 'pending'))).toEqual([
      { type: 'tool_call', callId: 'call-1', tool: 'bash', input: { command: 'ls' } },
    ]);
  });

  it('reports a tool that settles before publishing any arguments', () => {
    const mapper = new OpenCodeEventMapper(sessionId);
    expect(mapper.map(toolPart({}, 'completed', { output: 'ok' }))).toEqual([
      { type: 'tool_call', callId: 'call-1', tool: 'bash' },
      { type: 'tool_result', callId: 'call-1', tool: 'bash', ok: true, output: 'ok' },
    ]);
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
    /* The first state this call reports is already terminal, so its call is
     * published without arguments rather than letting a result stand alone. */
    expect(events).toEqual([
      { type: 'tool_call', callId: 'call-2', tool: 'bash' },
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
