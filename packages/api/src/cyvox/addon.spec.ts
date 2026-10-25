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

  it('keeps the existing loopback development connection available', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { headers: { 'Content-Type': 'application/json' } }));
    const app = express().use(createCyvoxAddonRouter('http://127.0.0.1:18000', true));

    const response = await request(app).get('/readiness');

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('CyVox privileged Work and Robot boundary', () => {
  afterEach(() => jest.restoreAllMocks());

  const admin = () => express()
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
      new Response(JSON.stringify({ emergency_stopped: true }),
        { headers: { 'Content-Type': 'application/json' } }),
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
    const rejected = await request(admin()).post('/actions/selectModel')
      .set('X-CyVox-Confirm', 'yes').send({ model: 'google/lyria-3-pro-preview' });
    expect(rejected.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not accept path traversal for task approvals', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const result = await request(admin()).post('/tasks/validTask/approvals/bad.id')
      .set('X-CyVox-Confirm', 'yes').send({ decision: 'approve_once' });
    expect(result.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects broad recurring approval; only approve_once or deny is allowed', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const result = await request(admin()).post('/tasks/validTask/approvals/appr123')
      .set('X-CyVox-Confirm', 'yes').send({ decision: 'approve_similar' });
    expect(result.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires a strict allowlist for robot actions', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const result = await request(admin()).post('/actions/deleteEverything')
      .set('X-CyVox-Confirm', 'yes');
    expect(result.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
