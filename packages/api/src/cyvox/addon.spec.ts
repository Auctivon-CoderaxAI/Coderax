import express from 'express';
import request from 'supertest';

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

  it('keeps the loopback development connection available to an ADMIN', async () => {
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
    const app = express().use(express.json()).use(createCyvoxAddonRouter('http://127.0.0.1:18000', true));

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
