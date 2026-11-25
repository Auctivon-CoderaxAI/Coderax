/**
 * Route-level coverage for the standing-authorization management API.
 *
 * `packages/api/src/agents/hitl/authorizations.spec.ts` drives the handlers
 * directly. This mounts the real `agents` router at /api/agents, so a request
 * traverses the production chain: requireJwtAuth → the v1 `/tools` mount →
 * the routes in tools.js → the controller → storage.
 *
 * JWT verification itself belongs to middleware/__tests__/requireJwtAuth.spec.js.
 * The gate here is a double, which is what lets the test assert that these
 * routes sit behind it and that storage stays untouched when it refuses.
 */

const express = require('express');
const request = require('supertest');

const mockRequireJwtAuth = jest.fn((req, res, next) => {
  const userId = req.get('x-test-user');
  if (!userId) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }
  req.user = {
    id: userId,
    role: req.get('x-test-role'),
    ...(req.get('x-test-tenant') ? { tenantId: req.get('x-test-tenant') } : {}),
  };
  next();
});
const mockList = jest.fn();
const mockCreate = jest.fn();
const mockRevoke = jest.fn();

jest.mock('@coderax/data-schemas', () => ({
  ...jest.requireActual('@coderax/data-schemas'),
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('@coderax/api', () => ({
  ...jest.requireActual('@coderax/api'),
  isEnabled: jest.fn().mockReturnValue(false),
  isAgentTriggerRequest: jest.fn(() => false),
  captureScheduleFireContext: jest.fn(),
}));

jest.mock('~/server/middleware', () => ({
  uaParser: (_req, _res, next) => next(),
  checkBan: (_req, _res, next) => next(),
  moderateText: (_req, _res, next) => next(),
  messageIpLimiter: (_req, _res, next) => next(),
  messageUserLimiter: (_req, _res, next) => next(),
  configMiddleware: (_req, _res, next) => next(),
  canAccessAgentResource: () => (_req, _res, next) => next(),
  toolCallLimiter: (_req, _res, next) => next(),
  requireJwtAuth: (req, res, next) => mockRequireJwtAuth(req, res, next),
}));

jest.mock('~/models', () => ({
  getFiles: jest.fn(),
  getMessages: jest.fn(),
  saveMessage: jest.fn(),
  saveConvo: jest.fn(),
  getPersistedPrivateTextId: jest.fn(),
  getPrivateMessageTexts: jest.fn(),
  getRoleByName: jest.fn(),
  listToolStandingAuthorizations: (...args) => mockList(...args),
  createToolStandingAuthorization: (...args) => mockCreate(...args),
  revokeToolStandingAuthorization: (...args) => mockRevoke(...args),
}));

// The real module is a middleware function carrying named controllers.
jest.mock('~/server/controllers/agents/steer', () => {
  const controller = (_req, _res, next) => next();
  controller.SteerDeliveryController = (_req, _res, next) => next();
  controller.SteerCancelController = (_req, _res, next) => next();
  controller.SteerArmController = (_req, _res, next) => next();
  return controller;
});

jest.mock('~/server/controllers/agents/queuedTurns', () => ({
  AgentQueuedTurnEnqueueController: (_req, res) => res.status(202).json({ queued: true }),
  AgentQueuedTurnEnqueueV2Controller: (_req, res) => res.status(202).json({ queued: true }),
  AgentQueuedTurnListController: (_req, res) => res.status(200).json({ queuedTurns: [] }),
  AgentQueuedTurnCancelController: (_req, res) => res.status(200).json({ cancelled: true }),
}));

jest.mock('~/server/controllers/agents/protocol', () => ({
  GENERATION_PROTOCOL_HEADER: 'x-generation-protocol',
  GENERATION_PROTOCOL_V2: 2,
  getRequestedGenerationProtocol: () => 1,
  getServerGenerationProtocol: () => 1,
  negotiateExistingGenerationProtocol: () => 1,
}));

// v1.js registers its agent CRUD routes at module load; only its `/tools` mount matters here.
jest.mock('~/server/controllers/agents/v1', () => {
  const stub = (_req, res) => res.status(501).json({ code: 'NOT_MOCKED' });
  return new Proxy({}, { get: () => stub });
});

jest.mock('~/server/controllers/tools', () => ({
  callTool: jest.fn(),
  verifyToolAuth: jest.fn(),
  getToolCalls: jest.fn(),
}));

jest.mock('~/server/controllers/PluginController', () => ({
  getAvailableTools: jest.fn(),
}));

jest.mock('~/server/services/PermissionService', () => ({
  checkPermission: jest.fn(),
}));

jest.mock('~/server/middleware/roles/capabilities', () => ({
  hasCapability: jest.fn(),
}));

jest.mock('~/server/services/MCP', () => ({
  resolveAllMcpConfigs: jest.fn(),
}));

jest.mock('~/server/services/Config', () => ({
  getMCPServerTools: jest.fn(),
}));

jest.mock('~/server/services/Schedules', () => ({
  recordScheduleOutcome: jest.fn(),
  beginScheduledStop: jest.fn(),
  acknowledgeScheduledStopPersistence: jest.fn(),
}));

jest.mock('~/server/routes/agents/actions', () => require('express').Router());
jest.mock('~/server/routes/agents/chat', () => require('express').Router());
jest.mock('~/server/routes/agents/management', () => require('express').Router());
jest.mock('~/server/routes/agents/openai', () => require('express').Router());
jest.mock('~/server/routes/agents/responses', () => require('express').Router());
jest.mock('~/server/routes/agents/skills', () => require('express').Router());

const agentsRouter = require('~/server/routes/agents/index');

const app = express();
app.use(express.json());
app.use('/api/agents', agentsRouter);

const grant = {
  id: 'standing-1',
  label: 'Zero-cost reads',
  tools: ['read_*'],
  createdAt: 1,
  maxCostUsd: 0,
};

const asOwner = (headers = {}) => ({
  'X-Test-User': 'owner-1',
  'X-Test-Role': 'ADMIN',
  ...headers,
});

beforeEach(() => {
  mockList.mockResolvedValue([grant]);
  mockCreate.mockResolvedValue({ ok: true, value: grant });
  mockRevoke.mockResolvedValue(true);
});

describe('mounted /api/agents/tools/authorizations routes', () => {
  it('refuses every method at the JWT gate before storage is touched', async () => {
    const list = await request(app).get('/api/agents/tools/authorizations');
    const create = await request(app)
      .post('/api/agents/tools/authorizations')
      .send({ label: 'Reads', tools: ['read_*'] });
    const revoke = await request(app).delete('/api/agents/tools/authorizations/standing-1');

    expect([list.status, create.status, revoke.status]).toEqual([401, 401, 401]);
    expect(mockRequireJwtAuth).toHaveBeenCalledTimes(3);
    expect(mockList).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockRevoke).not.toHaveBeenCalled();
  });

  it('lists through the v1 /tools mount, scoped to the caller', async () => {
    const response = await request(app)
      .get('/api/agents/tools/authorizations')
      .set(asOwner({ 'X-Test-Tenant': 'tenant-1' }));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ authorizations: [grant] });
    expect(mockList).toHaveBeenCalledWith({ userId: 'owner-1', tenantId: 'tenant-1' });
  });

  it('creates a grant and reads its id back for revocation', async () => {
    const body = { label: 'Reads', tools: ['read_*'], expiresAt: 4_000_000_000_000 };
    const created = await request(app)
      .post('/api/agents/tools/authorizations')
      .set(asOwner())
      .send(body);

    expect(created.status).toBe(201);
    expect(created.body).toEqual({ authorization: grant });
    expect(mockCreate).toHaveBeenCalledWith({ userId: 'owner-1' }, body);

    const revoked = await request(app)
      .delete(`/api/agents/tools/authorizations/${created.body.authorization.id}`)
      .set(asOwner());

    expect(revoked.status).toBe(200);
    expect(revoked.body).toEqual({ revoked: true });
    expect(mockRevoke).toHaveBeenCalledWith({ userId: 'owner-1' }, 'standing-1');
  });

  it('keeps a non-owner out at the controller', async () => {
    const response = await request(app)
      .get('/api/agents/tools/authorizations')
      .set(asOwner({ 'X-Test-Role': 'USER' }));

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ code: 'STANDING_AUTHORIZATION_FORBIDDEN' });
    expect(mockList).not.toHaveBeenCalled();
  });
});
