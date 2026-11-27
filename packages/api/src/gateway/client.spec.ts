import type { GatewayFetch } from './client';
import { GatewayTransportError, createEngineClient } from './client';
import * as sse from './sse';

const at = '2026-11-26T00:00:00.000Z';
const chat = {
  message: 'hello',
  conversationId: 'conv_1',
  agent: 'coderax',
  mode: 'private',
} as const;

type Recorded = { url: string; headers: Record<string, string>; body?: unknown };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function sseResponse(chunks: string[]) {
  const encoded = chunks.map((chunk) => new TextEncoder().encode(chunk));
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'text/event-stream' },
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

function clientWith(
  fetchImpl: GatewayFetch,
  token = 'server-token',
  timeout = 1_000,
  limits: {
    maxResponseBytes?: number;
    maxFrameBytes?: number;
    maxEventResyncs?: number;
  } = {},
) {
  return createEngineClient({
    baseURL: 'https://engine.example',
    token,
    requestTimeoutMs: timeout,
    streamIdleTimeoutMs: 1_000,
    fetch: fetchImpl,
    ...limits,
  });
}

function chatReply(conversationId: string) {
  return {
    conversationId,
    messageId: 'msg_1',
    text: 'hi',
    agent: 'coderax',
    model: { providerId: 'local', modelId: 'free' },
    createdAt: at,
  };
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

  it('preserves the engine path prefix for JSON and streaming requests', async () => {
    const urls: string[] = [];
    const client = createEngineClient({
      baseURL: 'https://engine.example/proxy//engine///',
      token: 'server-token',
      requestTimeoutMs: 1_000,
      streamIdleTimeoutMs: 1_000,
      fetch: async (url) => {
        urls.push(url);
        return url.endsWith('/v1/health') ? healthResponse() : jsonResponse(chatReply('conv_1'));
      },
    });

    await client.health();
    await client.submitChat({
      conversationId: 'conv_1',
      message: 'hi',
      agent: 'coderax',
      mode: 'private',
    });
    expect(urls).toEqual([
      'https://engine.example/proxy//engine/v1/health',
      'https://engine.example/proxy//engine/v1/chat',
    ]);
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

  it('fails closed after repeated EOF without cursor progress', async () => {
    const fetch = jest.fn(async () => sseResponse([]));
    const client = clientWith(fetch);
    await expect(
      client.streamTaskEvents('task_1', 0)[Symbol.asyncIterator]().next(),
    ).rejects.toMatchObject({ code: 'protocol_error' });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('resumes after a read failure and does not exhaust the budget while making progress', async () => {
    const cursors: string[] = [];
    const client = clientWith(async (url) => {
      const cursor = new URL(url).searchParams.get('after') ?? '';
      cursors.push(cursor);
      const seq = Number(cursor) + 1;
      const completed = seq === 8;
      const frame = new TextEncoder().encode(
        `data: ${JSON.stringify({
          v: 1,
          eventId: `evt_${seq}`,
          taskId: 'task_1',
          seq,
          at,
          agent: 'coderax',
          generation: 1,
          type: completed ? 'task.completed' : 'text.delta',
          payload: completed ? {} : { text: 'x' },
        })}\n\n`,
      );
      let sent = false;
      return {
        ...sseResponse([]),
        body: new ReadableStream<Uint8Array>({
          pull(controller) {
            if (!sent) {
              sent = true;
              controller.enqueue(frame);
            } else if (seq === 1) {
              controller.error(new TypeError('connection lost'));
            } else {
              controller.close();
            }
          },
        }),
      };
    });
    const collected: number[] = [];
    for await (const item of client.streamTaskEvents('task_1', 0)) {
      collected.push(item.seq);
    }
    expect(collected).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(cursors).toEqual(['0', '1', '2', '3', '4', '5', '6', '7']);
  });

  it('replays an unterminated terminal event from the last complete frame', async () => {
    const event = (seq: number, finish: boolean) =>
      `data: ${JSON.stringify({
        v: 1,
        eventId: `evt_${seq}`,
        taskId: 'task_1',
        seq,
        at,
        agent: 'coderax',
        generation: 1,
        type: finish ? 'task.completed' : 'text.delta',
        payload: finish ? {} : { text: 'x' },
      })}`;
    const readSseFrames = sse.readSseFrames;
    const fetch = jest
      .fn<ReturnType<GatewayFetch>, Parameters<GatewayFetch>>()
      .mockResolvedValueOnce(sseResponse([event(1, false) + '\n\n' + event(2, true)]))
      .mockImplementationOnce(async () => {
        // Apply the small limit only to the interrupted stream. A valid event exceeds 16 bytes.
        jest
          .spyOn(sse, 'readSseFrames')
          .mockImplementationOnce((body, options) =>
            readSseFrames(body, { ...options, maxFrameBytes: 16 }),
          );
        return sseResponse(['data: 1234567890\n']);
      })
      .mockResolvedValueOnce(sseResponse([event(2, true) + '\n\n']));
    const collected: number[] = [];
    for await (const item of clientWith(fetch).streamTaskEvents('task_1', 0)) {
      collected.push(item.seq);
    }
    expect(collected).toEqual([1, 2]);
    expect(fetch.mock.calls.map(([url]) => new URL(url).searchParams.get('after'))).toEqual([
      '0',
      '1',
      '1',
    ]);
  });

  it('does not replay malformed events', async () => {
    const fetch = jest.fn(async () => sseResponse(['data: invalid\n\n']));
    const client = clientWith(fetch);
    await expect(
      client.streamTaskEvents('task_1', 0)[Symbol.asyncIterator]().next(),
    ).rejects.toMatchObject({ code: 'protocol_error' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('aborts fetch while waiting for upstream headers', async () => {
    const client = clientWith(
      async (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
      'server-token',
      15,
    );
    await expect(
      client.streamTaskEvents('task_1', 0)[Symbol.asyncIterator]().next(),
    ).rejects.toMatchObject({ code: 'engine_timeout' });
  });

  it('treats a Work header timeout as ambiguous while keeping read timeouts retryable', async () => {
    const fetch = jest.fn<ReturnType<GatewayFetch>, Parameters<GatewayFetch>>(
      async (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    );
    const client = clientWith(fetch, 'server-token', 15);

    await expect(
      client.submitWork({ objective: 'test', mode: 'cloud', requireApproval: true }),
    ).rejects.toMatchObject({ code: 'submission_outcome_unknown', retryable: false });
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(client.getTask('task_1')).rejects.toMatchObject({
      code: 'engine_timeout',
      retryable: true,
    });
  });

  it('clears the header timer while keeping a live stream linked to caller cancellation', async () => {
    const caller = new AbortController();
    let transportSignal: AbortSignal | undefined;
    const client = clientWith(
      async (_url, { signal }) => {
        transportSignal = signal;
        return sseResponse([]);
      },
      'server-token',
      15,
    );
    await client.submitChat(chat, caller.signal);
    await new Promise((resolve) => setTimeout(resolve, 35));
    expect(transportSignal?.aborted).toBe(false);
    caller.abort();
    expect(transportSignal?.aborted).toBe(true);
  });

  it.each([200, 503])(
    'does not suggest retrying a stalled chat response at status %i',
    async (status) => {
      const cancel = jest.fn();
      const client = clientWith(
        async () => new Response(new ReadableStream({ cancel }), { status }),
        'server-token',
        15,
      );
      await expect(client.submitChat(chat)).rejects.toMatchObject({
        code: 'submission_outcome_unknown',
        retryable: false,
      });
      expect(cancel).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps an engine reply in the conversation the caller addressed', async () => {
    const client = clientWith(async () => jsonResponse(chatReply('conv_1')));
    const outcome = await client.submitChat({
      message: 'hi',
      conversationId: 'conv_1',
      agent: 'coderax',
      mode: 'private',
    });
    expect(outcome.kind).toBe('json');
  });

  it('refuses a chat reply recorded in a different conversation', async () => {
    const client = clientWith(async () => jsonResponse(chatReply('conv_other')));
    await expect(
      client.submitChat({
        message: 'hi',
        conversationId: 'conv_1',
        agent: 'coderax',
        mode: 'private',
      }),
    ).rejects.toMatchObject({ code: 'protocol_error' });
  });

  it('treats a rejected Work submission as an unknown, non-retryable outcome', async () => {
    const client = clientWith(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(
      client.submitWork({
        objective: 'do the thing',
        mode: 'cloud',
        requireApproval: true,
      }),
    ).rejects.toMatchObject({
      code: 'submission_outcome_unknown',
      retryable: false,
    });
  });

  it('refuses a Work task created in a different conversation', async () => {
    const client = clientWith(async () =>
      jsonResponse(
        {
          taskId: 'task_1',
          conversationId: 'conv_other',
          state: 'queued',
          generation: 0,
          eventsPath: '/v1/work/task_1/events',
        },
        202,
      ),
    );
    await expect(
      client.submitWork({
        objective: 'do the thing',
        conversationId: 'conv_1',
        mode: 'cloud',
        requireApproval: true,
      }),
    ).rejects.toMatchObject({ code: 'protocol_error' });
  });

  it('honors a configured JSON response budget', async () => {
    const client = clientWith(async () => jsonResponse({ agents: [] }), 'server-token', 1_000, {
      maxResponseBytes: 8,
    });
    await expect(client.listAgents()).rejects.toMatchObject({ code: 'protocol_error' });
  });

  it('honors a configured no-progress resync budget', async () => {
    const fetch = jest.fn(async () => sseResponse([]));
    const client = clientWith(fetch, 'server-token', 1_000, { maxEventResyncs: 0 });
    await expect(
      client.streamTaskEvents('task_1', 0)[Symbol.asyncIterator]().next(),
    ).rejects.toMatchObject({ code: 'protocol_error' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([0, 2])('caps repeated sequence gaps at %i reconnects', async (maxEventResyncs) => {
    const event = {
      v: 1,
      eventId: 'evt_2',
      taskId: 'task_1',
      seq: 2,
      at,
      agent: 'coderax',
      generation: 1,
      type: 'task.completed',
      payload: {},
    };
    const fetch = jest.fn(async () => sseResponse([`data: ${JSON.stringify(event)}\n\n`]));
    const client = clientWith(fetch, 'server-token', 1_000, { maxEventResyncs });
    await expect(
      client.streamTaskEvents('task_1', 0)[Symbol.asyncIterator]().next(),
    ).rejects.toMatchObject({ code: 'protocol_error' });
    expect(fetch).toHaveBeenCalledTimes(maxEventResyncs + 1);
  });

  it.each([
    ['ECONNRESET', 'submission_outcome_unknown', false],
    ['ECONNREFUSED', 'engine_unreachable', true],
  ])('classifies chat header failures (%s)', async (code, expectedCode, retryable) => {
    const fetch = jest.fn(async () => {
      throw new TypeError('fetch failed', { cause: { code } });
    });
    const client = clientWith(fetch);
    await expect(client.submitChat(chat)).rejects.toMatchObject({ code: expectedCode, retryable });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('honors a configured SSE frame budget', async () => {
    const event = JSON.stringify({
      v: 1,
      eventId: 'evt_1',
      taskId: 'task_1',
      seq: 1,
      at,
      agent: 'coderax',
      generation: 1,
      type: 'text.delta',
      payload: { text: 'hi' },
    });
    const client = clientWith(
      async () => sseResponse([`data: ${event}\n\n`]),
      'server-token',
      1_000,
      {
        maxFrameBytes: 8,
      },
    );
    const outcome = await client.submitChat(chat);
    if (outcome.kind !== 'stream') {
      throw new Error('expected a stream');
    }
    await expect(outcome.frames[Symbol.asyncIterator]().next()).rejects.toBeInstanceOf(
      sse.SseProtocolError,
    );
  });

  it.each(['ordinary JSON', 'chat JSON', 'stream error'])(
    'cancels oversized %s before EOF',
    async (path) => {
      const cancel = jest.fn();
      const client = clientWith(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                // 2 Mi characters, but more than the 4 MiB limit on the wire.
                controller.enqueue(new TextEncoder().encode('€'.repeat(2 * 1024 * 1024)));
              },
              cancel,
            }),
            { status: path === 'stream error' ? 503 : 200 },
          ),
      );
      const result = path === 'ordinary JSON' ? client.listAgents() : client.submitChat(chat);
      await expect(result).rejects.toMatchObject({ code: 'protocol_error' });
      expect(cancel).toHaveBeenCalledTimes(1);
    },
  );
});
