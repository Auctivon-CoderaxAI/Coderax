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
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}'));
    const app = express().use(createCyvoxAddonRouter('http://127.0.0.1:18000', true));

    const response = await request(app).get('/readiness');

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
