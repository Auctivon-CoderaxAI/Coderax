import express from 'express';
import request from 'supertest';
import { CYVOX_THINKING_EFFORTS } from 'coderax-data-provider';

import { createCyvoxAddonRouter } from './addon';

describe('CyVox add-on target', () => {
  afterEach(() => jest.restoreAllMocks());

  it('calls an explicitly configured HTTPS service with its application token', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ready: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const app = express()
      .use((req, _res, next) => {
        Object.assign(req, { user: { role: 'ADMIN' } });
        next();
      })
      .use(createCyvoxAddonRouter('https://cyvox.example.com', true, 'secret'));

    const response = await request(app).get('/readiness');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ready: true });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://cyvox.example.com/api/readiness'),
      expect.objectContaining({
        redirect: 'error',
        headers: { Accept: 'application/json', Authorization: 'Bearer secret' },
      }),
    );
  });

  it('limits remote CyVox status to Coderax administrators', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const app = express().use(createCyvoxAddonRouter('https://cyvox.example.com', true, 'secret'));

    const response = await request(app).get('/activity');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ code: 'CYVOX_FORBIDDEN' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['http://cyvox.example.com', 'secret'],
    ['https://cyvox.example.com', undefined],
    ['https://cyvox.example.com/path', 'secret'],
  ])('rejects an unsafe or unauthenticated remote target', async (baseUrl, token) => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const app = express().use(createCyvoxAddonRouter(baseUrl, true, token));

    const response = await request(app).get('/readiness');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ code: 'CYVOX_NOT_CONFIGURED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps an administrative loopback development connection available', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('{}', { headers: { 'Content-Type': 'application/json' } }));
    const app = express()
      .use((req, _res, next) => {
        Object.assign(req, { user: { role: 'ADMIN' } });
        next();
      })
      .use(createCyvoxAddonRouter('http://127.0.0.1:18000', true));

    const response = await request(app).get('/readiness');

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['anonymous activity', undefined, '/activity'],
    ['non-admin activity', 'USER', '/activity'],
    ['anonymous approvals', undefined, '/tasks/task123/approvals'],
    ['non-admin approvals', 'USER', '/tasks/task123/approvals'],
  ])('denies loopback %s without forwarding', async (_case, role, path) => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const app = express()
      .use((req, _res, next) => {
        if (role) Object.assign(req, { user: { role } });
        next();
      })
      .use(createCyvoxAddonRouter('http://127.0.0.1:18000', true));

    const response = await request(app).get(path);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ code: 'CYVOX_FORBIDDEN' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('denies loopback writes without ADMIN even with explicit confirmation', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const app = express()
      .use(express.json())
      .use(createCyvoxAddonRouter('http://127.0.0.1:18000', true));

    const response = await request(app).post('/actions/robotStop').set('X-CyVox-Confirm', 'yes');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ code: 'CYVOX_FORBIDDEN' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['constructor', 'toString', '__proto__'])(
    'rejects inherited resource key %s before upstream forwarding',
    async (resource) => {
      const fetchMock = jest.spyOn(global, 'fetch');
      const app = express()
        .use((req, _res, next) => {
          Object.assign(req, { user: { role: 'ADMIN' } });
          next();
        })
        .use(createCyvoxAddonRouter('http://127.0.0.1:18000', true));

      const response = await request(app).get(`/${resource}`);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ code: 'CYVOX_RESOURCE_NOT_FOUND' });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});

describe('CyVox loopback authorization', () => {
  afterEach(() => jest.restoreAllMocks());

  const loopback = (role?: string) => {
    const app = express();
    if (role) {
      app.use((req, _res, next) => {
        Object.assign(req, { user: { role } });
        next();
      });
    }
    return app.use(createCyvoxAddonRouter('http://127.0.0.1:18000', true));
  };

  it('refuses an anonymous read without calling the upstream service', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');

    const response = await request(loopback()).get('/activity');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ code: 'CYVOX_FORBIDDEN' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a signed-in non-admin read without calling the upstream service', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');

    const response = await request(loopback('USER')).get('/activity');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ code: 'CYVOX_FORBIDDEN' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a non-admin approval read', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');

    const response = await request(loopback('USER')).get('/tasks/task123/approvals');

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards an administrative loopback read to the mapped upstream path', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ entries: [] }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const response = await request(loopback('ADMIN')).get('/activity');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ entries: [] });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('http://127.0.0.1:18000/api/audit?limit=100'),
      expect.objectContaining({ redirect: 'error' }),
    );
  });

  it.each(['constructor', 'toString', '__proto__'])(
    'rejects the inherited resource name %s without calling the upstream service',
    async (resource) => {
      const fetchMock = jest.spyOn(global, 'fetch');

      const response = await request(loopback('ADMIN')).get(`/${resource}`);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ code: 'CYVOX_RESOURCE_NOT_FOUND' });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});

describe('CyVox privileged Work and Robot boundary', () => {
  afterEach(() => jest.restoreAllMocks());

  const admin = () =>
    express()
      .use(express.json())
      .use((req, _res, next) => {
        Object.assign(req, { user: { role: 'ADMIN' } });
        next();
      })
      .use(createCyvoxAddonRouter('https://cyvox.example.com', true, 'secret'));

  it('never forwards a Robot write without owner confirmation', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const result = await request(admin()).post('/actions/robotStop');
    expect(result.status).toBe(428);
    expect(result.body.code).toBe('CYVOX_CONFIRMATION_REQUIRED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows a confirmed emergency stop without exposing the upstream token', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ emergency_stopped: true }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const result = await request(admin()).post('/actions/robotStop').set('X-CyVox-Confirm', 'yes');
    expect(result.status).toBe(200);
    expect(result.body.emergency_stopped).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://cyvox.example.com/api/robot/stop'),
      expect.objectContaining({ method: 'POST', redirect: 'error' }),
    );
  });

  it('rejects unauthenticated and non-admin Robot control', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const app = express().use(createCyvoxAddonRouter('https://cyvox.example.com', true, 'secret'));
    const result = await request(app).post('/actions/robotStop').set('X-CyVox-Confirm', 'yes');
    expect(result.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('whitelists free and local model IDs but rejects billed provider IDs', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ selected: true }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const rejected = await request(admin())
      .post('/actions/selectModel')
      .set('X-CyVox-Confirm', 'yes')
      .send({ model: 'openai:gpt-4o' });
    expect(rejected.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();

    const accepted = await request(admin())
      .post('/actions/selectModel')
      .set('X-CyVox-Confirm', 'yes')
      .send({ model: 'ollama:llama3:latest' });
    expect(accepted.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://cyvox.example.com/api/models/select'),
      expect.objectContaining({
        body: JSON.stringify({
          chat_model: 'ollama:llama3:latest',
          agent_model: 'ollama:llama3:latest',
        }),
      }),
    );
  });

  it('does not accept path traversal for task approvals', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const result = await request(admin())
      .post('/tasks/validTask/approvals/bad.id')
      .set('X-CyVox-Confirm', 'yes')
      .send({ decision: 'approve_once' });
    expect(result.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects broad recurring approval; only approve_once or deny is allowed', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const result = await request(admin())
      .post('/tasks/validTask/approvals/appr123')
      .set('X-CyVox-Confirm', 'yes')
      .send({ decision: 'approve_similar' });
    expect(result.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires a strict allowlist for robot actions', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const result = await request(admin())
      .post('/actions/deleteEverything')
      .set('X-CyVox-Confirm', 'yes');
    expect(result.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// This test remains inside the same privileged bridge suite.
describe('CyVox zero-cost routing policy', () => {
  afterEach(() => jest.restoreAllMocks());

  /** CyVox accepts AUTO, LOCAL, and FAST. AUTO delegates per-task
   * classification to CyVox's zero-cost router instead of forcing fast. */
  it('delegates task classification to CyVox with AUTO for a confirmed owner Work task', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'task-1' }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const app = express()
      .use(express.json())
      .use((req, _res, next) => {
        Object.assign(req, { user: { role: 'ADMIN' } });
        next();
      })
      .use(createCyvoxAddonRouter('https://cyvox.example.com', true, 'secret'));
    const response = await request(app)
      .post('/actions/startTask')
      .set('X-CyVox-Confirm', 'yes')
      .send({ task: 'Inspect tests', mode: 'Autonomous Run' });
    expect(response.status).toBe(200);
    const options = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(options.body))).toEqual({
      task: 'Inspect tests',
      mode: 'Autonomous Run',
      max_steps: 15,
      routing_mode: 'AUTO',
    });
  });
});

describe('CyVox per-task selection contract', () => {
  afterEach(() => jest.restoreAllMocks());

  const admin = () =>
    express()
      .use(express.json())
      .use((req, _res, next) => {
        Object.assign(req, { user: { role: 'ADMIN' } });
        next();
      })
      .use(createCyvoxAddonRouter('https://cyvox.example.com', true, 'secret'));

  const created = () =>
    new Response(JSON.stringify({ id: 'task-1' }), {
      headers: { 'Content-Type': 'application/json' },
    });

  const bodyOf = (fetchMock: jest.SpyInstance) =>
    JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));

  it('sends the selected model and thinking effort with the task', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(created());
    const response = await request(admin())
      .post('/actions/startTask')
      .set('X-CyVox-Confirm', 'yes')
      .send({
        task: '  Inspect tests  ',
        mode: 'Coding Team',
        model: 'ollama:llama3:latest',
        thinking_effort: 'high',
      });

    expect(response.status).toBe(200);
    expect(bodyOf(fetchMock)).toEqual({
      task: 'Inspect tests',
      mode: 'Coding Team',
      max_steps: 15,
      routing_mode: 'AUTO',
      model: 'ollama:llama3:latest',
      thinking_effort: 'high',
    });
  });

  it.each([undefined, null, ''])(
    'omits an unset selection (%p) instead of sending an empty value',
    async (value) => {
      const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(created());
      const response = await request(admin())
        .post('/actions/startTask')
        .set('X-CyVox-Confirm', 'yes')
        .send({
          task: 'Inspect tests',
          mode: 'Autonomous Run',
          model: value,
          thinking_effort: value,
        });

      expect(response.status).toBe(200);
      expect(bodyOf(fetchMock)).toEqual({
        task: 'Inspect tests',
        mode: 'Autonomous Run',
        max_steps: 15,
        routing_mode: 'AUTO',
      });
    },
  );

  it('rejects a billed model without submitting a task', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ models: [] }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const response = await request(admin())
      .post('/actions/startTask')
      .set('X-CyVox-Confirm', 'yes')
      .send({ task: 'Inspect tests', mode: 'Autonomous Run', model: 'openai:gpt-4o' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ code: 'CYVOX_NONFREE_MODEL_REJECTED' });
    expect(fetchMock.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual([
      '/api/models',
    ]);
  });

  it('rejects an unknown thinking effort before contacting CyVox', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const response = await request(admin())
      .post('/actions/startTask')
      .set('X-CyVox-Confirm', 'yes')
      .send({ task: 'Inspect tests', mode: 'Autonomous Run', thinking_effort: 'ultra' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ code: 'CYVOX_INVALID_THINKING_EFFORT' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(CYVOX_THINKING_EFFORTS)('accepts the supported effort %s', async (effort) => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(created());
    const response = await request(admin())
      .post('/actions/startTask')
      .set('X-CyVox-Confirm', 'yes')
      .send({ task: 'Inspect tests', mode: 'Autonomous Run', thinking_effort: effort });

    expect(response.status).toBe(200);
    expect(bodyOf(fetchMock).thinking_effort).toBe(effort);
  });

  it('accepts a raw installed Ollama model confirmed by the inventory', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/models') {
        return new Response(
          JSON.stringify({
            models: [{ name: 'llama3:latest', location: 'OLLAMA', compatible_now: true }],
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }
      return created();
    });
    const response = await request(admin())
      .post('/actions/startTask')
      .set('X-CyVox-Confirm', 'yes')
      .send({ task: 'Inspect tests', mode: 'Autonomous Run', model: 'llama3:latest' });

    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual([
      '/api/models',
      '/api/tasks',
    ]);
    const taskBody = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body));
    expect(taskBody).toEqual({
      task: 'Inspect tests',
      mode: 'Autonomous Run',
      max_steps: 15,
      routing_mode: 'AUTO',
      model: 'llama3:latest',
    });
  });

  it('rejects a raw model the inventory does not report as installed Ollama', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/models') {
        return new Response(
          JSON.stringify({
            models: [{ name: 'mistral:latest', location: 'OLLAMA', compatible_now: true }],
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }
      return created();
    });
    const response = await request(admin())
      .post('/actions/startTask')
      .set('X-CyVox-Confirm', 'yes')
      .send({ task: 'Inspect tests', mode: 'Autonomous Run', model: 'llama3:latest' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ code: 'CYVOX_NONFREE_MODEL_REJECTED' });
    expect(fetchMock.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual([
      '/api/models',
    ]);
  });

  it('still rejects a paid gateway model even when the inventory lists it', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/models') {
        return new Response(
          JSON.stringify({
            models: [{ name: 'openai:gpt-4o', location: 'MODELGATEWAY', compatible_now: true }],
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }
      return created();
    });
    const response = await request(admin())
      .post('/actions/startTask')
      .set('X-CyVox-Confirm', 'yes')
      .send({ task: 'Inspect tests', mode: 'Autonomous Run', model: 'openai:gpt-4o' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ code: 'CYVOX_NONFREE_MODEL_REJECTED' });
    expect(fetchMock.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual([
      '/api/models',
    ]);
  });

  it('never writes the deployment-global model while starting a task', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(created());
    await request(admin()).post('/actions/startTask').set('X-CyVox-Confirm', 'yes').send({
      task: 'Inspect tests',
      mode: 'Autonomous Run',
      model: 'ollama:llama3:latest',
      thinking_effort: 'medium',
    });

    const paths = fetchMock.mock.calls.map(([input]) => new URL(String(input)).pathname);
    expect(paths).toEqual(['/api/tasks']);
    expect(paths).not.toContain('/api/models/select');
  });
});

describe('CyVox upstream response bounds', () => {
  afterEach(() => jest.restoreAllMocks());

  const admin = () =>
    express()
      .use((req, _res, next) => {
        Object.assign(req, { user: { role: 'ADMIN' } });
        next();
      })
      .use(createCyvoxAddonRouter('https://cyvox.example.com', true, 'secret'));

  it('rejects an oversized declared response without buffering it', async () => {
    let sent = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1024;
        controller.enqueue(new Uint8Array(1024));
      },
      cancel() {
        cancelled = true;
      },
    });
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(stream, {
        headers: { 'Content-Type': 'application/json', 'Content-Length': '2097152' },
      }),
    );

    const response = await request(admin()).get('/activity');

    expect(response.status).toBe(502);
    expect(response.body).toEqual({ code: 'CYVOX_RESPONSE_TOO_LARGE' });
    // Construction may prime one chunk; the body is never drained to its declared size.
    expect(sent).toBeLessThanOrEqual(1024);
    expect(cancelled).toBe(true);
  });

  it('stops reading an undeclared response stream once it exceeds the bound', async () => {
    let sent = 0;
    let cancelled = false;
    const chunk = new Uint8Array(64 * 1024).fill(32);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(stream, { headers: { 'Content-Type': 'application/json' } }));

    const response = await request(admin()).get('/tasks');

    expect(response.status).toBe(502);
    expect(response.body).toEqual({ code: 'CYVOX_RESPONSE_TOO_LARGE' });
    expect(cancelled).toBe(true);
    expect(sent).toBeLessThan(2 * 1024 * 1024);
  });
});

describe('CyVox privileged Work and Robot boundary', () => {
  afterEach(() => jest.restoreAllMocks());

  const admin = () =>
    express()
      .use(express.json())
      .use((req, _res, next) => {
        Object.assign(req, { user: { role: 'ADMIN' } });
        next();
      })
      .use(createCyvoxAddonRouter('https://cyvox.example.com', true, 'secret'));

  it('never forwards a Robot write without owner confirmation', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const result = await request(admin()).post('/actions/robotStop');
    expect(result.status).toBe(428);
    expect(result.body.code).toBe('CYVOX_CONFIRMATION_REQUIRED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows a confirmed emergency stop without exposing the upstream token', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ emergency_stopped: true }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const result = await request(admin()).post('/actions/robotStop').set('X-CyVox-Confirm', 'yes');
    expect(result.status).toBe(200);
    expect(result.body.emergency_stopped).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://cyvox.example.com/api/robot/stop'),
      expect.objectContaining({ method: 'POST', redirect: 'error' }),
    );
  });

  it('rejects unauthenticated and non-admin Robot control', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const app = express().use(createCyvoxAddonRouter('https://cyvox.example.com', true, 'secret'));
    const result = await request(app).post('/actions/robotStop').set('X-CyVox-Confirm', 'yes');
    expect(result.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('whitelists free and local model IDs but rejects billed provider IDs', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ selected: true }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const rejected = await request(admin())
      .post('/actions/selectModel')
      .set('X-CyVox-Confirm', 'yes')
      .send({ model: 'openai:gpt-4o' });
    expect(rejected.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();

    const accepted = await request(admin())
      .post('/actions/selectModel')
      .set('X-CyVox-Confirm', 'yes')
      .send({ model: 'ollama:llama3:latest' });
    expect(accepted.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://cyvox.example.com/api/models/select'),
      expect.objectContaining({
        body: JSON.stringify({
          chat_model: 'ollama:llama3:latest',
          agent_model: 'ollama:llama3:latest',
        }),
      }),
    );
  });

  it('does not accept path traversal for task approvals', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const result = await request(admin())
      .post('/tasks/validTask/approvals/bad.id')
      .set('X-CyVox-Confirm', 'yes')
      .send({ decision: 'approve_once' });
    expect(result.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects broad recurring approval; only approve_once or deny is allowed', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const result = await request(admin())
      .post('/tasks/validTask/approvals/appr123')
      .set('X-CyVox-Confirm', 'yes')
      .send({ decision: 'approve_similar' });
    expect(result.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires a strict allowlist for robot actions', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const result = await request(admin())
      .post('/actions/deleteEverything')
      .set('X-CyVox-Confirm', 'yes');
    expect(result.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// This test remains inside the same privileged bridge suite.
describe('CyVox fast routing contract', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sends FAST for a confirmed owner Work task', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'task-1' }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const app = express()
      .use(express.json())
      .use((req, _res, next) => {
        Object.assign(req, { user: { role: 'ADMIN' } });
        next();
      })
      .use(createCyvoxAddonRouter('https://cyvox.example.com', true, 'secret'));
    const response = await request(app)
      .post('/actions/startTask')
      .set('X-CyVox-Confirm', 'yes')
      .send({ task: 'Inspect tests', mode: 'Autonomous Run' });
    expect(response.status).toBe(200);
    const options = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(options.body))).toEqual({
      task: 'Inspect tests',
      mode: 'Autonomous Run',
      max_steps: 15,
      routing_mode: 'FAST',
    });
  });
});
