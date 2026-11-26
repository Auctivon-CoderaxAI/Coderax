import type { GatewayFetch } from './client';
import { GatewayTransportError, createEngineClient } from './client';

const at = '2026-11-26T00:00:00.000Z';

type Recorded = { url: string; headers: Record<string, string>; body?: unknown };

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify(body),
    body: null,
  };
}

function sseResponse(chunks: string[]) {
  const encoded = chunks.map((chunk) => new TextEncoder().encode(chunk));
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'text/event-stream' },
    text: async () => '',
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of encoded) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    }),
  };
}

function healthResponse(contractVersion = '1.0.0') {
  return jsonResponse({
    status: 'ok',
    contractVersion,
    startedAt: at,
    uptimeMs: 1,
    checks: [],
    engines: [
      {
        id: 'native',
        capabilities: {
          streaming: true,
          tools: true,
          cancellation: true,
          resume: true,
          modelSelection: true,
          durable: true,
        },
        availability: { available: true, reason: 'ready', detail: '' },
      },
    ],
  });
}

function clientWith(fetchImpl: GatewayFetch, token = 'server-token') {
  return createEngineClient({
    baseURL: 'https://engine.example',
    token,
    requestTimeoutMs: 1_000,
    streamIdleTimeoutMs: 1_000,
    fetch: fetchImpl,
  });
}

describe('WorkflowEngine client', () => {
  it('attaches the server credential to owner operations only', async () => {
    const calls: Recorded[] = [];
    const client = clientWith(async (url, init) => {
      calls.push({ url, headers: init.headers, body: init.body });
      if (url.endsWith('/v1/health')) {
        return healthResponse();
      }
      return jsonResponse({ agents: [] });
    });

    await client.health();
    await client.listAgents();

    expect(calls[0].headers.authorization).toBeUndefined();
    expect(calls[1].headers.authorization).toBe('Bearer server-token');
    expect(calls.every((call) => call.url.includes('/v1/'))).toBe(true);
  });

  it('never includes the token or the URL in an error', async () => {
    const client = clientWith(async () => jsonResponse({ error: 'nope' }, 401));
    await expect(client.listAgents()).rejects.toMatchObject({
      code: 'unauthorized',
      status: 401,
    });
    try {
      await client.listAgents();
    } catch (error) {
      const transport = error as GatewayTransportError;
      expect(transport.message).not.toContain('server-token');
      expect(transport.message).not.toContain('engine.example');
    }
  });

  it('refuses a response that does not match the pinned contract', async () => {
    const client = clientWith(async () => jsonResponse({ agents: [{ id: 'rogue' }] }));
    await expect(client.listAgents()).rejects.toMatchObject({ code: 'protocol_error' });
  });

  it('maps a documented problem body onto its stable engine code', async () => {
    const client = clientWith(async () =>
      jsonResponse(
        {
          type: 'https://coderax.dev/problems/not_found',
          title: 'not found',
          status: 404,
          code: 'not_found',
          detail: 'No task with that id.',
          retryable: false,
        },
        404,
      ),
    );
    const error = await client.getTask('task_1').catch((cause: unknown) => cause);
    expect(error).toMatchObject({ code: 'not_found', status: 404 });
    // Raw upstream detail is not forwarded to a browser-facing error.
    expect((error as GatewayTransportError).detail).toBeUndefined();
  });

  it('returns a JSON chat reply when the engine answers with JSON', async () => {
    const client = clientWith(async () =>
      jsonResponse({
        conversationId: 'conv_1',
        messageId: 'msg_1',
        text: 'hi',
        agent: 'coderax',
        model: { providerId: 'local', modelId: 'free' },
        createdAt: at,
      }),
    );
    const outcome = await client.submitChat({ message: 'hi', agent: 'coderax', mode: 'private' });
    expect(outcome.kind).toBe('json');
  });

  it('streams validated chat frames when the engine answers with SSE', async () => {
    const client = clientWith(async () =>
      sseResponse([
        `data: ${JSON.stringify({
          v: 1,
          eventId: 'evt_1',
          taskId: 'task_1',
          seq: 1,
          at,
          agent: 'coderax',
          generation: 1,
          type: 'text.delta',
          payload: { text: 'hi' },
        })}\n\n`,
      ]),
    );
    const outcome = await client.submitChat({ message: 'hi', agent: 'coderax', mode: 'private' });
    expect(outcome.kind).toBe('stream');
    if (outcome.kind !== 'stream') {
      return;
    }
    const frames = [];
    for await (const frame of outcome.frames) {
      frames.push(frame);
    }
    expect(frames).toHaveLength(1);
    expect(frames[0].kind).toBe('event');
  });

  it('deduplicates replayed events and resynchronises from a gap', async () => {
    const calls: string[] = [];
    const event = (seq: number, type = 'text.delta') =>
      JSON.stringify({
        v: 1,
        eventId: `evt_${seq}`,
        taskId: 'task_1',
        seq,
        at,
        agent: 'coderax',
        generation: 1,
        ...(type === 'text.delta' ? { type, payload: { text: `t${seq}` } } : { type, payload: {} }),
      });

    const client = clientWith(async (url) => {
      calls.push(url);
      if (calls.length === 1) {
        // seq 2 is missing: the consumer resyncs from after=1.
        return sseResponse([`data: ${event(1)}\n\n`, `data: ${event(3)}\n\n`]);
      }
      return sseResponse([
        // Replay an event the consumer already saw; it must stay deduplicated.
        `data: ${event(1)}\n\n`,
        `data: ${event(2)}\n\n`,
        `data: ${event(3)}\n\n`,
        `data: ${event(4, 'task.completed')}\n\n`,
      ]);
    });

    const received: number[] = [];
    for await (const item of client.streamTaskEvents('task_1', 0)) {
      received.push(item.seq);
    }

    expect(received).toEqual([1, 2, 3, 4]);
    expect(calls[1]).toContain('after=1');
  });

  it('fails closed when the event stream ends without a terminal event', async () => {
    let calls = 0;
    const client = clientWith(async () => {
      calls += 1;
      return sseResponse([
        `data: ${JSON.stringify({
          v: 1,
          eventId: `evt_${calls}`,
          taskId: 'task_1',
          seq: calls,
          at,
          agent: 'coderax',
          generation: 1,
          type: 'text.delta',
          payload: { text: 'x' },
        })}\n\n`,
      ]);
    });

    await expect(async () => {
      for await (const _event of client.streamTaskEvents('task_1', 0)) {
        // consume
      }
    }).rejects.toMatchObject({ code: 'protocol_error' });
  });
});
