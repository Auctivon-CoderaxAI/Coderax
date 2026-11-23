const { promisify } = require('util');
const express = require('express');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

/**
 * `dist` points at a directory that does not exist. With `SERVE_CLIENT=false`
 * the server must still boot and answer 404 for page routes, rather than
 * reading a placeholder index.html that makes a missing build look healthy.
 */
jest.mock('~/server/services/Config', () => ({
  syncStaticTools: jest.fn().mockResolvedValue(undefined),
  mergeAppTools: jest.fn().mockResolvedValue(undefined),
  loadCustomConfig: jest.fn(() => Promise.resolve({})),
  getAppConfig: jest.fn().mockResolvedValue({
    paths: {
      uploads: '/tmp',
      dist: '/tmp/coderax-no-shell-dist',
      fonts: '/tmp/coderax-no-shell-fonts',
      assets: '/tmp/coderax-no-shell-assets',
    },
    fileStrategy: 'local',
    imageOutputType: 'PNG',
  }),
  setCachedTools: jest.fn(),
}));

jest.mock('~/app/clients/tools', () => ({
  createOpenAIImageTools: jest.fn(() => []),
  createYouTubeTools: jest.fn(() => []),
  manifestToolMap: {},
  toolkits: [],
}));

jest.mock('~/config', () => ({
  createMCPServersRegistry: jest.fn(),
  createMCPManager: jest.fn().mockResolvedValue({
    getAppToolFunctions: jest.fn().mockResolvedValue({}),
  }),
}));

jest.mock('~/server/services/Agents/triggers', () => ({
  initializeAgentTriggerService: jest.fn().mockResolvedValue(undefined),
  setWorkflowEventHandler: jest.fn(),
}));

jest.mock('~/server/services/Schedules', () => ({
  initializeScheduleEngine: jest.fn().mockResolvedValue(undefined),
}));

jest.mock(
  '@coderax/api/telemetry',
  () => ({
    initializeTelemetry: jest.fn(() => ({
      enabled: false,
      status: 'disabled',
      shutdown: jest.fn(),
    })),
    telemetryMiddleware: jest.fn((_req, _res, next) => next()),
    telemetryErrorMiddleware: jest.fn((err, _req, _res, next) => next(err)),
  }),
  { virtual: true },
);

describe('API-only mode (SERVE_CLIENT=false)', () => {
  jest.setTimeout(30_000);

  let mongoServer;
  let app;
  let server;

  beforeAll(async () => {
    process.env.SERVE_CLIENT = 'false';
    process.env.PORT = '0';
    mongoServer = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongoServer.getUri();

    /* index.js starts listening asynchronously and exports only the app, so capture
       the server as listen runs; a failed poll still leaves a server to close. */
    const listen = express.application.listen;
    const listenSpy = jest.spyOn(express.application, 'listen').mockImplementation(function (
      ...args
    ) {
      server = listen.apply(this, args);
      return server;
    });
    try {
      app = require('~/server');
      await healthCheckPoll(app);
      await readinessCheckPoll(app);
    } finally {
      listenSpy.mockRestore();
    }
  });

  afterAll(async () => {
    delete process.env.SERVE_CLIENT;
    try {
      if (server) {
        await promisify(server.close).call(server);
      }
    } finally {
      try {
        if (mongoServer) {
          await mongoServer.stop();
        }
      } finally {
        await mongoose.disconnect();
      }
    }
  });

  it('boots and answers API health without a client build', async () => {
    const health = await request(app).get('/health');
    expect(health.status).toBe(200);
    expect(health.text).toBe('OK');

    const ready = await request(app).get('/readyz');
    expect(ready.status).toBe(200);
    expect(ready.text).toBe('OK');
  });

  it('returns 404 for page routes instead of an SPA shell', async () => {
    for (const route of ['/', '/index.html', '/c/example-conversation']) {
      const response = await request(app).get(route);
      expect([route, response.status]).toEqual([route, 404]);
      expect([route, response.text.includes('<div id="root">')]).toEqual([route, false]);
    }
  });

  it('keeps the JSON 404 for unknown API routes', async () => {
    const response = await request(app).get('/api/does-not-exist');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: 'Endpoint not found' });
  });
});

async function healthCheckPoll(app, retries = 0) {
  const maxRetries = Math.floor(10000 / 30);
  try {
    const response = await request(app).get('/health');
    if (response.status === 200) {
      return;
    }
  } catch {
    // Ignore connection errors during polling
  }

  if (retries < maxRetries) {
    await new Promise((resolve) => setTimeout(resolve, 30));
    await healthCheckPoll(app, retries + 1);
  } else {
    throw new Error('App did not become healthy within 10 seconds.');
  }
}

async function readinessCheckPoll(app, retries = 0) {
  const maxRetries = Math.floor(10000 / 30);
  try {
    const response = await request(app).get('/readyz');
    if (response.status === 200) {
      return;
    }
  } catch {
    // Ignore connection errors during polling
  }

  if (retries < maxRetries) {
    await new Promise((resolve) => setTimeout(resolve, 30));
    await readinessCheckPoll(app, retries + 1);
  } else {
    throw new Error('App did not become ready within 10 seconds.');
  }
}
