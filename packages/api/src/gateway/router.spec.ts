import express from 'express';
import { get } from 'node:http';
import request from 'supertest';
import { once } from 'node:events';
import type { WorkflowEngineGatewayDeps } from './router';
import type { GatewayFetch } from './client';
import { createWorkflowEngineGateway } from './router';

const at = '2026-11-26T00:00:00.000Z';

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

function health(contractVersion = '1.0.0') {
  return {
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
  };
}

function appFor(fetchImpl: GatewayFetch, overrides: Partial<WorkflowEngineGatewayDeps> = {}) {
  const gateway = createWorkflowEngineGateway({
    resolveConfig: () => ({
      enabled: true,
      baseURL: 'https://engine.example',
      tokenEnv: 'ENGINE_TOKEN',
    }),
    env: { ENGINE_TOKEN: 'server-token' } as NodeJS.ProcessEnv,
    fetch: fetchImpl,
    requireOwner: () => ({ ok: true, value: { userId: 'owner_1' } }),
    ...overrides,
  });
  const app = express();
  app.use(express.json());
  app.use(gateway.router);
  return { app, gateway };
}

describe('workflow engine gateway routes', () => {
  it('fails closed when the transport is disabled', async () => {
    const { app } = appFor(async () => jsonResponse({}), {
      resolveConfig: () => ({ enabled: false }),
    });
    const response = await request(app).get('/health');
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('WORKFLOW_ENGINE_DISABLED');
  });

  it('rejects a non-owner before any engine call', async () => {
    let called = false;
    const { app } = appFor(
      async () => {
        called = true;
        return jsonResponse({});
      },
      { requireOwner: () => ({ ok: false, status: 403, code: 'WORKFLOW_ENGINE_FORBIDDEN' }) },
    );
    const response = await request(app).get('/agents');
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('WORKFLOW_ENGINE_FORBIDDEN');
    expect(called).toBe(false);
  });

  it('fails closed when the server token is missing', async () => {
    const { app } = appFor(async () => jsonResponse({}), {
      env: {} as NodeJS.ProcessEnv,
    });
    const response = await request(app).get('/agents');
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('WORKFLOW_ENGINE_TOKEN_MISSING');
  });

  it('refuses a contract version mismatch', async () => {
    const { app } = appFor(async () => jsonResponse(health('2.0.0')));
    const response = await request(app).get('/agents');
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('WORKFLOW_ENGINE_CONTRACT_VERSION_MISMATCH');
  });

  it('proxies with the server credential, not the caller header', async () => {
    const headers: Record<string, string>[] = [];
    const { app } = appFor(async (url, init) => {
      headers.push(init.headers);
      return url.endsWith('/v1/health') ? jsonResponse(health()) : jsonResponse({ agents: [] });
    });

    const response = await request(app).get('/agents').set('authorization', 'Bearer caller-token');

    expect(response.status).toBe(200);
    const ownerCall = headers.find((header) => header.authorization != null);
    expect(ownerCall?.authorization).toBe('Bearer server-token');
    expect(headers.every((header) => header.authorization !== 'Bearer caller-token')).toBe(true);
  });

  it('validates a chat body before calling the engine', async () => {
    let calls = 0;
    const { app } = appFor(async (url) => {
      calls += 1;
      return url.endsWith('/v1/health') ? jsonResponse(health()) : jsonResponse({});
    });

    const response = await request(app).post('/chat').send({ message: '' });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('WORKFLOW_ENGINE_INVALID_REQUEST');
    expect(calls).toBe(1);
  });

  it('maps an engine problem onto the same status and stable code', async () => {
    const { app } = appFor(async (url) => {
      if (url.endsWith('/v1/health')) {
        return jsonResponse(health());
      }
      return jsonResponse(
        {
          type: 'https://coderax.dev/problems/not_found',
          title: 'not found',
          status: 404,
          code: 'not_found',
          retryable: false,
        },
        404,
      );
    });

    const response = await request(app).get('/tasks/task_1');
    expect(response.status).toBe(404);
    expect(response.body.engineCode).toBe('not_found');
  });

  it('streams sequenced events as server-sent frames', async () => {
    const { app } = appFor(async (url) => {
      if (url.endsWith('/v1/health')) {
        return jsonResponse(health());
      }
      return sseResponse([
        `data: ${JSON.stringify({
          v: 1,
          eventId: 'evt_1',
          taskId: 'task_1',
          seq: 1,
          at,
          agent: 'coderax',
          generation: 1,
          type: 'task.completed',
          payload: {},
        })}\n\n`,
      ]);
    });

    const response = await request(app).get('/tasks/task_1/events?after=0');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.headers['cache-control']).toBe('no-store, no-transform');
    expect(response.text).toContain('"seq":1');
    expect(response.text).toContain('"type":"task.completed"');
  });

  it('exposes artifact metadata without inventing a content route', async () => {
    const { app } = appFor(async (url) => {
      if (url.endsWith('/v1/health')) {
        return jsonResponse(health());
      }
      return jsonResponse({
        taskId: 'task_1',
        conversationId: 'conv_1',
        state: 'completed',
        agent: 'coderax',
        mode: 'cloud',
        generation: 1,
        createdAt: at,
        updatedAt: at,
        cancelRequested: false,
        steps: [],
        result: { artifacts: [{ path: 'report.md' }] },
      });
    });

    const response = await request(app).get('/tasks/task_1/artifacts');
    expect(response.status).toBe(200);
    expect(response.body.artifacts).toEqual([{ path: 'report.md' }]);
    expect(response.body.content).toBe('unsupported');
  });

  it('reports unknown Work submission outcomes without offering a retry', async () => {
    const fetch: GatewayFetch = jest.fn(async (url) => {
      if (url.endsWith('/v1/health')) {
        return jsonResponse(health());
      }
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.error(new TypeError('connection lost'));
        },
      });
      return new Response(body, { status: 202 });
    });
    const { app } = appFor(fetch);

    const response = await request(app).post('/work').send({ objective: 'do the thing' });
    expect(response.status).toBe(502);
    expect(response.body).toEqual({
      code: 'WORKFLOW_ENGINE_ERROR',
      engineCode: 'submission_outcome_unknown',
      retryable: false,
      detail: 'The engine may have accepted the work, but its response could not be read.',
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['refused before connection', 'ECONNREFUSED', 'engine_unreachable', true],
    ['reset before headers', 'ECONNRESET', 'submission_outcome_unknown', false],
  ])('classifies a Work request %s', async (_label, code, engineCode, retryable) => {
    const { app } = appFor(async (url) => {
      if (url.endsWith('/v1/health')) {
        return jsonResponse(health());
      }
      throw new TypeError('fetch failed', { cause: { code } });
    });

    const response = await request(app).post('/work').send({ objective: 'do the thing' });
    expect(response.status).toBe(502);
    expect(response.body).toMatchObject({
      code: 'WORKFLOW_ENGINE_ERROR',
      engineCode,
      retryable,
    });
  });

  it('refuses an engine without the capabilities a Work task needs', async () => {
    const withoutDurable = health();
    withoutDurable.engines[0].capabilities.durable = false;
    const { app } = appFor(async (url) =>
      url.endsWith('/v1/health') ? jsonResponse(withoutDurable) : jsonResponse({}),
    );

    const response = await request(app).post('/work').send({ objective: 'do the thing' });
    expect(response.status).toBe(501);
    expect(response.body.code).toBe('WORKFLOW_ENGINE_UNSUPPORTED');
  });

  it('reports readiness from the engine, not compatibility alone', async () => {
    const { app } = appFor(async (url) => {
      if (url.endsWith('/v1/health')) {
        return jsonResponse(health());
      }
      return jsonResponse({ ready: false, missing: ['model'], checks: [] });
    });

    const response = await request(app).get('/ready');
    expect(response.status).toBe(503);
    expect(response.body.ready).toBe(false);
    expect(response.body.missing).toEqual(['model']);
  });

  it('never forwards a dot-only conversation id to the engine', async () => {
    let calls = 0;
    const { app } = appFor(async (url) => {
      calls += 1;
      return url.endsWith('/v1/health') ? jsonResponse(health()) : jsonResponse({});
    });

    const response = await request(app).get('/conversations/%2e%2e');
    // The client normalizes the path before Express receives it.
    expect(response.status).toBe(404);
    expect(calls).toBe(1);
  });

  it('rejects a decoded dot-only conversation id at the route guard', async () => {
    const fetch = jest.fn<ReturnType<GatewayFetch>, Parameters<GatewayFetch>>(async () =>
      jsonResponse(health()),
    );
    const { app } = appFor(fetch);
    const server = app.listen(0, '127.0.0.1');
    try {
      await once(server, 'listening');
      const address = server.address();
      if (address == null || typeof address === 'string') {
        throw new Error('Expected a listening TCP address');
      }
      // Send the path as written, without URL dot segment normalization.
      const response = await new Promise<{ status: number | undefined; body: string }>(
        (resolve, reject) => {
          get(
            { host: address.address, port: address.port, path: '/conversations/%2e%2e' },
            (res) => {
              let body = '';
              res.setEncoding('utf8');
              res.on('data', (chunk: string) => (body += chunk));
              res.on('end', () => resolve({ status: res.statusCode, body }));
              res.on('error', reject);
            },
          ).on('error', reject);
        },
      );

      expect(response.status).toBe(400);
      expect(JSON.parse(response.body)).toMatchObject({ code: 'WORKFLOW_ENGINE_INVALID_REQUEST' });
      expect(fetch.mock.calls).toEqual([['https://engine.example/v1/health', expect.any(Object)]]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it.each([false, true])(
    'refuses Work with split capabilities (second engine available: %s)',
    async (available) => {
      const report = health();
      const engine = report.engines[0];
      report.engines = [
        { ...engine, capabilities: { ...engine.capabilities, durable: false } },
        {
          ...engine,
          id: 'other',
          availability: { ...engine.availability, available },
          capabilities: { ...engine.capabilities, resume: false },
        },
      ];
      const fetch: GatewayFetch = jest.fn(async () => jsonResponse(report));
      const { app } = appFor(fetch);
      const response = await request(app).post('/work').send({ objective: 'do the thing' });
      expect(response.status).toBe(501);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects operator configuration for a contract the gateway does not implement', async () => {
    const fetch = jest.fn(async () => jsonResponse(health('2.0.0')));
    const { app } = appFor(fetch, {
      resolveConfig: () => ({
        enabled: true,
        baseURL: 'https://engine.example',
        tokenEnv: 'ENGINE_TOKEN',
        contractVersion: '2.0.0',
      }),
    });
    const response = await request(app).get('/contract');
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('WORKFLOW_ENGINE_INVALID_CONFIG');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses rotated credentials and refreshes capabilities before dispatch', async () => {
    const env = { ENGINE_TOKEN: 'first-token' };
    const report = health();
    const credentials: (string | undefined)[] = [];
    const { app } = appFor(
      async (url, init) => {
        if (url.endsWith('/v1/health')) {
          return jsonResponse(report);
        }
        credentials.push(init.headers.authorization);
        return jsonResponse({ agents: [] });
      },
      { env },
    );
    await request(app).get('/agents').expect(200);
    env.ENGINE_TOKEN = 'second-token';
    await request(app).get('/agents').expect(200);
    expect(credentials).toEqual(['Bearer first-token', 'Bearer second-token']);
    report.engines[0].capabilities.resume = false;
    await request(app).post('/tasks/task_1/resume').send({}).expect(501);
    expect(credentials).toHaveLength(2);
  });

  it.each([200, 503])(
    'reports a reachable but unready engine (upstream status %i)',
    async (status) => {
      const { app } = appFor(async (url) =>
        url.endsWith('/v1/ready')
          ? jsonResponse({ ready: false, missing: [], checks: [] }, status)
          : jsonResponse(health()),
      );
      const response = await request(app).get('/ready').expect(503);
      expect(response.body).toMatchObject({
        ready: false,
        code: 'WORKFLOW_ENGINE_ENGINE_NOT_READY',
      });
    },
  );

  it('reports ready only when the upstream readiness probe passes', async () => {
    const { app } = appFor(async (url) =>
      url.endsWith('/v1/ready')
        ? jsonResponse({ ready: true, missing: [], checks: [] })
        : jsonResponse(health()),
    );
    const response = await request(app).get('/ready').expect(200);
    expect(response.body).toMatchObject({ ready: true, contractVersion: '1.0.0' });
  });

  it('distinguishes a failed readiness connection from a not-ready report', async () => {
    const { app } = appFor(async (url) => {
      if (url.endsWith('/v1/ready')) throw new TypeError('connection lost');
      return jsonResponse(health());
    });
    const response = await request(app).get('/ready').expect(502);
    expect(response.body.engineCode).toBe('engine_unreachable');
  });

  it('reports the pinned and served contract after the handshake', async () => {
    const { app } = appFor(async () => jsonResponse(health()));
    const response = await request(app).get('/contract');
    expect(response.status).toBe(200);
    expect(response.body.pinnedContractVersion).toBe('1.0.0');
    expect(response.body.engineContractVersion).toBe('1.0.0');
  });
});
