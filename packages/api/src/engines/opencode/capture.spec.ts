import type { EngineEvent } from '../types';
import capture from './__fixtures__/capture.json';
import { OpenCodeEventMapper } from './protocol';

/**
 * Replays a stream recorded from a real `opencode serve`, not a hand-written one.
 *
 * Provenance: OpenCode 1.19.5 (2026-11-24), one prompt driven through the HTTP
 * API against a stub OpenAI-compatible provider so the turn is deterministic
 * while every event still comes from OpenCode itself. The fixture keeps the
 * events the mapper reads, verbatim and in order; `plugin.added` heartbeats are
 * the only type dropped. It contains the user message and the prompt's own text
 * part, which is what the mapper used to publish as the reply.
 */

const SESSION = 'ses_df18ec965ffeJugIkT516kUkvQ';
const PROMPT = 'CODERAX_CAPTURE_PROMPT write the capture file';
const EDITED = '/tmp/oc/run/work/captured.txt';

function replyText(events: EngineEvent[]): string {
  return events
    .map((event) =>
      event.type === 'text_delta' || event.type === 'text_replace' ? event.text : '',
    )
    .join('');
}

describe('captured OpenCode event stream', () => {
  const map = (): EngineEvent[] => {
    const mapper = new OpenCodeEventMapper(SESSION);
    return capture.flatMap((event) => mapper.map(event));
  };
  const events = map();

  it('answers with the assistant text and never with the prompt the user sent', () => {
    expect(replyText(events)).toBe('WROTE_CAPTURED');
    const streamed = events
      .map((event) =>
        event.type === 'text_delta' || event.type === 'text_replace' ? event.text : '',
      )
      .join('');
    expect(streamed).not.toContain(PROMPT);
    expect(streamed).not.toContain('CODERAX_CAPTURE_PROMPT');
  });

  it('reports the tool call, its result and the edited file from the same stream', () => {
    const calls = events.filter((event) => event.type === 'tool_call');
    expect(calls).toEqual([
      { type: 'tool_call', callId: 'call_capture', tool: 'write', input: {} },
    ]);
    expect(events.filter((event) => event.type === 'tool_result')).toEqual([
      {
        type: 'tool_result',
        callId: 'call_capture',
        tool: 'write',
        ok: true,
        output: 'Wrote file successfully.',
      },
    ]);
    expect(events.filter((event) => event.type === 'file_edit')).toEqual([
      { type: 'file_edit', path: EDITED },
    ]);
  });

  it('finishes the turn on the captured `session.idle`', () => {
    const terminal = events.filter((event) => event.type === 'completed');
    expect(terminal).toEqual([{ type: 'completed', sessionId: SESSION }]);
    expect(events.some((event) => event.type === 'usage')).toBe(true);
  });
});
