const express = require('express');
const request = require('supertest');

jest.mock('coderax-data-provider', () => ({
  PermissionBits: { VIEW: 1 },
  buildFreeInferenceWorkSources: jest.fn((config) =>
    config?.freeInference?.enabled ? [{ id: 'free-model', provider: 'FreeOpenRouter' }] : [],
  ),
  describeFreeInferenceCatalog: jest.fn((config) => ({
    enabled: config?.freeInference?.enabled === true,
  })),
}));

jest.mock('~/server/middleware/config/app', () => ({
  strictConfigMiddleware: jest.fn((req, _res, next) => {
    req.config = { config: { freeInference: { enabled: true } } };
    next();
  }),
}));

let mockLeaseStore;
let mockHandlerOptions;

jest.mock('@coderax/api', () => {
  const express = require('express');
  const leaseStore = (mockLeaseStore = {});
  return {
    createWorkDepsFactory: jest.fn(() => () => ({ listModels: async () => [] })),
    createWorkRouter: jest.fn((deps) => {
      const router = express.Router();
      router.get('/models', async (_req, res) => {
        res.json({ models: await deps.listModels() });
      });
      router.get('/readiness', (_req, res) => {
        res.json({ enabled: deps.freeInference().enabled });
      });
      return router;
    }),
    getAgentListAccess: jest.fn(),
    createWorkAgentPageLoader: jest.fn(() => async () => []),
    GenerationJobManager: { onGenerationSettled: jest.fn() },
    persistTerminalWorkState: jest.fn(),
    workStateForJobStatus: jest.fn(),
    getFreeRouterForConfig: jest.fn(() => ({ snapshot: () => ({}) })),
    createEngineWorkChatHandler: jest.fn((options) => {
      mockHandlerOptions = options;
      return (_req, _res, next) => next();
    }),
    createEngineWorkChatPersistence: jest.fn(),
    createWorkRunLeaseStore: jest.fn(() => leaseStore),
    readEngineWorkState: jest.fn(async (scope, runtime) => runtime.state(scope)),
    getEngineWorkChatRuntime: jest.fn(() => ({
      state: async () => null,
      cancel: async () => false,
      snapshot: () => ({}),
    })),
  };
});

jest.mock('~/models', () => ({ getListAgentsByAccess: jest.fn() }));
jest.mock('~/server/controllers/ModelController', () => ({ loadModels: jest.fn() }));
jest.mock('~/server/services/PermissionService', () => ({ findAccessibleResources: jest.fn() }));
jest.mock('~/server/middleware/roles/capabilities', () => ({ hasCapability: jest.fn() }));
jest.mock('@coderax/data-schemas', () => ({ logger: { warn: jest.fn() } }));
jest.mock('../workChat', () => ({
  getWorkChatRouter: () => {
    const router = require('express').Router();
    router.use('/chat', (req, res) => {
      res.json({ enabled: req.config?.config?.freeInference?.enabled === true });
    });
    return router;
  },
  configuredDefaultFromRequest: jest.fn(),
}));
jest.mock('../workModels', () => ({
  flattenModelConfig: jest.fn(),
  toWorkConversation: jest.fn(),
  rowsFromCursor: jest.fn(),
  onlyWorkRows: jest.fn(),
}));

const app = express();
app.use('/api/work', require('../work'));
let server;
let agent;

describe('Work configuration-backed read routes', () => {
  beforeAll(() => {
    server = app.listen(0);
    agent = request.agent(server);
  });

  afterAll(
    () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      }),
  );

  it('loads strict config before building the model catalog', async () => {
    const response = await agent.get('/api/work/models');

    expect(response.status).toBe(200);
    expect(response.body.models).toEqual([{ id: 'free-model', provider: 'FreeOpenRouter' }]);
  });

  it('loads strict config before describing free inference readiness', async () => {
    const response = await agent.get('/api/work/readiness');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ enabled: true });
  });

  it('starts chat runs on the same durable lease store the read routes consult', () => {
    const { getEngineWorkChatRuntime } = jest.requireMock('@coderax/api');
    const config = { engines: { workChat: { enabled: true } } };

    expect(mockHandlerOptions.runtimeFor(config)).toBeTruthy();
    expect(getEngineWorkChatRuntime).toHaveBeenCalledWith(config, mockLeaseStore);
  });

  it('loads strict config before the chat admission reads hosted free models', async () => {
    const response = await agent.get('/api/work/chat');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ enabled: true });
  });
});
