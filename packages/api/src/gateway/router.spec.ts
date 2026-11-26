import express from 'express';
import request from 'supertest';
import type { WorkflowEngineGatewayDeps } from './router';
import type { GatewayFetch } from './client';
import { createWorkflowEngineGateway } from './router';

const at = '2026-11-26T00:00:00.000Z';

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
    // Express normalises the dot segment before routing; the gateway guard is a
    // second layer for engines reached through a different path normaliser.
    expect(response.status).toBe(404);
    expect(calls).toBe(1);
  });

  it('reports the pinned and served contract after the handshake', async () => {
    const { app } = appFor(async () => jsonResponse(health()));
    const response = await request(app).get('/contract');
    expect(response.status).toBe(200);
    expect(response.body.pinnedContractVersion).toBe('1.0.0');
    expect(response.body.engineContractVersion).toBe('1.0.0');
  });
});
