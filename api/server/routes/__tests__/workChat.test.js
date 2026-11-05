const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const { createWorkApiRouter } = require('../workApi');
const {
  createWorkChatRouter,
  delegateToAgents,
  resolveWorkContext,
  resolveConfiguredDefaultModel,
  stripClientWorkFields,
  workContextMiddleware,
  seedWorkConversation,
} = require('../workChat');

const LOCAL = { id: 'llama3:latest', label: 'Llama 3', provider: 'ollama', local: true };
const FREE = { id: 'free/alpha', label: 'Alpha', provider: 'custom', free: true };
const PAID = { id: 'gpt-4o', label: 'gpt-4o', provider: 'openAI' };

/** Minimal res double: records the status and body the middleware produced. */
const response = () => ({
  statusCode: 0,
  payload: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.payload = body;
    return this;
  },
});

const noConversationSeed = async () => ({ seeded: false, reason: 'no_target' });

test('auto resolves through the configured default when it is offered', () => {
  assert.deepEqual(resolveWorkContext([PAID, FREE, LOCAL], 'auto', 'llama3:latest'), {
    isWork: true,
    workModel: 'llama3:latest',
    workProvider: 'ollama',
  });
  assert.deepEqual(resolveWorkContext([PAID, FREE, LOCAL], 'auto', 'free/alpha'), {
    isWork: true,
    workModel: 'free/alpha',
    workProvider: 'custom',
  });
});

test('auto never picks an arbitrary alternate when no default is configured', () => {
  assert.deepEqual(resolveWorkContext([PAID, FREE, LOCAL], 'auto', null), {
    error: 'WORK_AUTO_UNRESOLVED',
  });
  assert.deepEqual(resolveWorkContext([PAID, FREE, LOCAL], 'auto', undefined), {
    error: 'WORK_AUTO_UNRESOLVED',
  });
  assert.deepEqual(resolveWorkContext([PAID, FREE, LOCAL], 'auto', '   '), {
    error: 'WORK_AUTO_UNRESOLVED',
  });
});

test('a paid configured default is rejected rather than used or swapped', () => {
  assert.deepEqual(resolveWorkContext([PAID, LOCAL], 'auto', 'gpt-4o'), {
    error: 'WORK_AUTO_UNRESOLVED',
  });
});

test('a paid model request is refused rather than silently replaced', () => {
  assert.deepEqual(resolveWorkContext([PAID, LOCAL], 'gpt-4o', 'llama3:latest'), {
    error: 'WORK_MODEL_NOT_ALLOWED',
  });
});

test('an allowed pick is kept even when a different default exists', () => {
  assert.deepEqual(resolveWorkContext([PAID, LOCAL, FREE], 'free/alpha', 'llama3:latest'), {
    isWork: true,
    workModel: 'free/alpha',
    workProvider: 'custom',
  });
});

test('no free or local model at all is reported as such', () => {
  assert.deepEqual(resolveWorkContext([PAID], 'auto', 'gpt-4o'), { error: 'WORK_NO_FREE_MODEL' });
  assert.deepEqual(resolveWorkContext([], 'auto', 'llama3:latest'), {
    error: 'WORK_NO_FREE_MODEL',
  });
});

test('a client cannot stamp the marker or model into the body', () => {
  assert.deepEqual(
    stripClientWorkFields({ text: 'plan', model: 'auto', isWork: false, workModel: 'gpt-4o' }),
    { text: 'plan', model: 'auto' },
  );
  assert.deepEqual(stripClientWorkFields({ text: 'plan', workContext: { isWork: true } }), {
    text: 'plan',
  });
  assert.equal(stripClientWorkFields(null), null);
});

test('the alias middleware sets server-owned context and strips client claims', async () => {
  const middleware = workContextMiddleware(
    async () => ({ ollama: [{ model: 'llama3:latest' }] }),
    () => 'llama3:latest',
    noConversationSeed,
  );
  const req = {
    body: { text: 'plan', model: 'auto', isWork: true, workModel: 'gpt-4o' },
    user: {},
  };
  const res = response();
  let continued = false;
  await middleware(req, res, () => {
    continued = true;
  });

  assert.equal(continued, true);
  assert.deepEqual(req.workContext, {
    isWork: true,
    workModel: 'llama3:latest',
    workProvider: 'ollama',
  });
  assert.equal(req.body.isWork, undefined);
  assert.equal(req.body.workModel, undefined);
  assert.equal(req.body.text, 'plan');
});

test('the alias hands the handler the concrete model, never the auto sentinel', async () => {
  const middleware = workContextMiddleware(
    async () => ({ ollama: [{ model: 'llama3:latest' }] }),
    () => 'llama3:latest',
    noConversationSeed,
  );
  const req = { body: { text: 'plan', model: 'auto' }, user: {} };
  const res = response();
  let received;
  await middleware(req, res, () => {
    received = req.body.model;
  });

  assert.equal(received, 'llama3:latest');
  assert.notEqual(received, 'auto');
  assert.equal(req.workContext.workModel, received);
  assert.equal(req.body.endpoint, 'ollama');
});

test('an omitted model resolves through the configured default', async () => {
  const middleware = workContextMiddleware(
    async () => ({ ollama: [{ model: 'llama3:latest' }], lmstudio: ['qwen2.5'] }),
    () => 'qwen2.5',
    noConversationSeed,
  );
  const req = { body: { text: 'plan' }, user: {} };
  const res = response();
  let received;
  await middleware(req, res, () => {
    received = req.body.model;
  });

  assert.equal(received, 'qwen2.5');
  assert.equal(req.body.model, req.workContext.workModel);
});

test('auto without a configured default is refused before the handler runs', async () => {
  const middleware = workContextMiddleware(async () => ({ ollama: [{ model: 'llama3:latest' }] }));
  const req = { body: { text: 'plan', model: 'auto' }, user: {} };
  const res = response();
  let continued = false;
  await middleware(req, res, () => {
    continued = true;
  });

  assert.equal(continued, false);
  assert.equal(res.statusCode, 409);
  assert.equal(res.payload.error, 'WORK_AUTO_UNRESOLVED');
  assert.match(res.payload.message, /Choose a model explicitly/);
});

test('the alias middleware refuses a paid model before the chat handler runs', async () => {
  const middleware = workContextMiddleware(
    async () => ({ openAI: [{ model: 'gpt-4o' }] }),
    () => 'gpt-4o',
  );
  const req = { body: { text: 'plan', model: 'gpt-4o' }, user: {} };
  const res = response();
  let continued = false;
  await middleware(req, res, () => {
    continued = true;
  });

  assert.equal(continued, false);
  assert.equal(res.statusCode, 409);
  assert.equal(res.payload.error, 'WORK_MODEL_NOT_ALLOWED');
});

test('model discovery failure becomes an actionable 503, not a crash', async () => {
  const middleware = workContextMiddleware(async () => {
    throw new Error('config unavailable');
  });
  const res = response();
  let continued = false;
  await middleware({ body: { text: 'plan' }, user: {} }, res, () => {
    continued = true;
  });

  assert.equal(continued, false);
  assert.equal(res.statusCode, 503);
  assert.equal(res.payload.error, 'WORK_MODELS_UNAVAILABLE');
});

/** Records what the seed asked the store to persist. */
const fakeDb = (existing = null) => {
  const saves = [];
  return {
    saves,
    getConvo: async () => existing,
    saveConvo: async (ctx, fields, meta) => {
      saves.push({ ctx, fields, meta });
      return { ...fields, conversationId: fields.conversationId };
    },
  };
};

test('seeds a new Work conversation with the marker and the authenticated owner', async () => {
  const db = fakeDb();
  const result = await seedWorkConversation(
    { user: { id: 'user-1' }, body: { conversationId: 'convo-1', userId: 'attacker' } },
    { isWork: true, workModel: 'llama3:latest' },
    db,
  );

  assert.deepEqual(result, { seeded: true });
  assert.equal(db.saves.length, 1);
  assert.equal(db.saves[0].ctx.userId, 'user-1');
  assert.equal(db.saves[0].fields.isWork, true);
  assert.equal(db.saves[0].fields.workModel, 'llama3:latest');
  assert.equal(db.saves[0].fields.conversationId, 'convo-1');
});

test('seeds the authenticated tenant on a new Work conversation, never the body tenant', async () => {
  const db = fakeDb();
  const result = await seedWorkConversation(
    {
      user: { id: 'user-1', tenantId: 'tenant-a' },
      body: { conversationId: 'convo-1', tenantId: 'tenant-b' },
    },
    { isWork: true, workModel: 'llama3:latest' },
    db,
  );

  assert.deepEqual(result, { seeded: true });
  assert.equal(db.saves.length, 1);
  assert.equal(db.saves[0].fields.tenantId, 'tenant-a');
  assert.equal(db.saves[0].fields.isWork, true);
  assert.equal(db.saves[0].ctx.userId, 'user-1');
});

test('uses trusted request tenant context when the authenticated user has no tenant field', async () => {
  const db = fakeDb();
  await seedWorkConversation(
    { user: { id: 'user-1' }, tenantId: 'tenant-a', body: { conversationId: 'convo-1' } },
    { isWork: true, workModel: 'llama3:latest' },
    db,
  );
  assert.equal(db.saves[0].fields.tenantId, 'tenant-a');
});

test('keeps legacy tenantless seeds tenantless', async () => {
  const db = fakeDb();
  await seedWorkConversation(
    { user: { id: 'user-1' }, body: { conversationId: 'convo-1', tenantId: 'spoofed' } },
    { isWork: true, workModel: 'llama3:latest' },
    db,
  );
  assert.equal(Object.hasOwn(db.saves[0].fields, 'tenantId'), false);
});

test('allows a matching-tenant Work follow-up without re-stamping its marker', async () => {
  const db = fakeDb({ conversationId: 'convo-1', isWork: true, tenantId: 'tenant-a' });
  const result = await seedWorkConversation(
    { user: { id: 'user-1', tenantId: 'tenant-a' }, body: { conversationId: 'convo-1' } },
    { isWork: true, workModel: 'llama3:latest' },
    db,
  );
  assert.deepEqual(result, { seeded: false, reason: 'exists' });
  assert.equal(db.saves.length, 0);
});

test('rejects foreign and legacy tenantless Work follow-ups before the native agent router', async () => {
  for (const existingTenant of ['tenant-b', undefined]) {
    const db = fakeDb({
      conversationId: 'convo-1',
      isWork: true,
      ...(existingTenant ? { tenantId: existingTenant } : {}),
    });
    const middleware = workContextMiddleware(
      async () => ({ ollama: [{ model: 'llama3:latest' }] }),
      () => 'llama3:latest',
      (req, context) => seedWorkConversation(req, context, db),
    );
    const req = {
      user: { id: 'user-1', tenantId: 'tenant-a' },
      body: { conversationId: 'convo-1', model: 'auto', text: 'continue' },
    };
    const res = response();
    let continued = false;
    await middleware(req, res, () => {
      continued = true;
    });
    assert.equal(continued, false);
    assert.equal(res.statusCode, 404);
    assert.equal(res.payload.error, 'WORK_TASK_NOT_FOUND');
    assert.equal(db.saves.length, 0);
  }
});

test('refuses to convert an existing non-Work conversation', async () => {
  const db = fakeDb({ conversationId: 'convo-1', isWork: false });
  const result = await seedWorkConversation(
    { user: { id: 'user-1' }, body: { conversationId: 'convo-1' } },
    { isWork: true, workModel: 'llama3:latest' },
    db,
  );

  assert.deepEqual(result, { seeded: false, reason: 'not_work' });
  assert.equal(db.saves.length, 0);
});

test('does nothing without an authenticated user or a conversation id', async () => {
  const noUser = fakeDb();
  assert.deepEqual(
    await seedWorkConversation({ body: { conversationId: 'c-1' } }, { workModel: 'm' }, noUser),
    { seeded: false, reason: 'no_target' },
  );
  assert.equal(noUser.saves.length, 0);

  const noConvo = fakeDb();
  assert.deepEqual(
    await seedWorkConversation({ user: { id: 'user-1' }, body: {} }, { workModel: 'm' }, noConvo),
    { seeded: false, reason: 'no_target' },
  );
  assert.equal(noConvo.saves.length, 0);
});

test('does not persist the new-chat route sentinel as a Work conversation', async () => {
  const db = fakeDb();
  const result = await seedWorkConversation(
    { user: { id: 'user-1' }, body: { conversationId: 'new' } },
    { isWork: true, workModel: 'llama3:latest' },
    db,
  );

  assert.deepEqual(result, { seeded: false, reason: 'no_target' });
  assert.equal(db.saves.length, 0);
});

test('storage failure during Work tenant verification fails closed before agent execution', async () => {
  for (const failingMethod of ['getConvo', 'saveConvo']) {
    const db = fakeDb();
    db[failingMethod] = async () => {
      throw new Error('private storage failure');
    };
    const middleware = workContextMiddleware(
      async () => ({ ollama: [{ model: 'llama3:latest' }] }),
      () => 'llama3:latest',
      (req, context) => seedWorkConversation(req, context, db),
    );
    const req = {
      body: { text: 'plan', model: 'auto', conversationId: 'c-1' },
      user: { id: 'user-1', tenantId: 'tenant-a' },
    };
    const res = response();
    let delegated = false;
    await middleware(req, res, () => {
      delegated = true;
    });

    assert.equal(delegated, false, failingMethod);
    assert.equal(res.statusCode, 503, failingMethod);
    assert.equal(res.payload.error, 'WORK_CONVERSATION_UNAVAILABLE', failingMethod);
    assert.doesNotMatch(JSON.stringify(res.payload), /private storage failure/);
    assert.equal(db.saves.length, 0, failingMethod);
  }
});

test('a nonthrowing failed or mismatched Work seed never delegates to an agent', async () => {
  const failures = [
    ['null storage result', null],
    ['swallowed storage exception', { message: 'private database error' }],
    ['foreign tenant', { conversationId: 'c-1', isWork: true, tenantId: 'tenant-b' }],
    ['missing Work marker', { conversationId: 'c-1', isWork: false, tenantId: 'tenant-a' }],
    ['different conversation', { conversationId: 'other', isWork: true, tenantId: 'tenant-a' }],
  ];
  for (const [label, returned] of failures) {
    const db = fakeDb();
    db.saveConvo = async () => returned;
    const middleware = workContextMiddleware(
      async () => ({ ollama: [{ model: 'llama3:latest' }] }),
      () => 'llama3:latest',
      (req, context) => seedWorkConversation(req, context, db),
    );
    const req = {
      body: { text: 'plan', model: 'auto', conversationId: 'c-1' },
      user: { id: 'user-1', tenantId: 'tenant-a' },
    };
    const res = response();
    let delegated = false;
    await middleware(req, res, () => {
      delegated = true;
    });
    assert.equal(delegated, false, label);
    assert.equal(res.statusCode, 503, label);
    assert.equal(res.payload.error, 'WORK_CONVERSATION_UNAVAILABLE', label);
    assert.doesNotMatch(JSON.stringify(res.payload), /private database error/);
  }
});

test('rejects a normal conversation before it reaches the Work agent router', async () => {
  const db = fakeDb({ conversationId: 'chat-1', isWork: false });
  const middleware = workContextMiddleware(
    async () => ({ ollama: [{ model: 'llama3:latest' }] }),
    () => 'llama3:latest',
    (req, context) => seedWorkConversation(req, context, db),
  );
  const req = {
    body: { text: 'plan', model: 'auto', conversationId: 'chat-1' },
    user: { id: 'user-1' },
  };
  const res = response();
  let continued = false;
  await middleware(req, res, () => {
    continued = true;
  });

  assert.equal(continued, false);
  assert.equal(res.statusCode, 409);
  assert.equal(res.payload.error, 'WORK_CONVERSATION_REQUIRED');
  assert.equal(db.saves.length, 0);
});

test('reads the hard default spec model from the real app config shape', () => {
  const config = {
    modelSpecs: {
      list: [
        { name: 'a', preset: { model: 'gpt-4o' } },
        { name: 'b', default: true, preset: { model: 'llama3:latest' } },
        { name: 'c', softDefault: true, preset: { model: 'qwen2.5' } },
      ],
    },
  };
  assert.equal(resolveConfiguredDefaultModel(config), 'llama3:latest');
});

test('falls back to the soft default when no hard default exists', () => {
  const config = {
    modelSpecs: { list: [{ name: 'c', softDefault: true, preset: { model: 'qwen2.5' } }] },
  };
  assert.equal(resolveConfiguredDefaultModel(config), 'qwen2.5');
});

test('returns null when the config names no concrete default model', () => {
  assert.equal(resolveConfiguredDefaultModel(undefined), null);
  assert.equal(resolveConfiguredDefaultModel({}), null);
  assert.equal(resolveConfiguredDefaultModel({ modelSpecs: { list: [] } }), null);
  assert.equal(
    resolveConfiguredDefaultModel({
      modelSpecs: { list: [{ default: true, preset: { agent_id: 'agent_1' } }] },
    }),
    null,
  );
  assert.equal(
    resolveConfiguredDefaultModel({
      modelSpecs: { list: [{ default: true, preset: { model: '  ' } }] },
    }),
    null,
  );
});

test('auto resolves through the real config adapter', async () => {
  const middleware = workContextMiddleware(
    async () => ({ ollama: [{ model: 'llama3:latest' }], lmstudio: ['qwen2.5'] }),
    undefined,
    async () => ({ seeded: false }),
  );
  const req = {
    body: { text: 'plan', model: 'auto' },
    user: { id: 'user-1' },
    config: {
      modelSpecs: { list: [{ name: 'local', default: true, preset: { model: 'qwen2.5' } }] },
    },
  };
  const res = response();
  let received;
  await middleware(req, res, () => {
    received = req.body.model;
  });

  assert.equal(received, 'qwen2.5');
  assert.equal(req.workContext.workModel, 'qwen2.5');
});

test('a paid config default still fails auto with the actionable error', async () => {
  const middleware = workContextMiddleware(async () => ({ ollama: [{ model: 'llama3:latest' }] }));
  const req = {
    body: { text: 'plan', model: 'auto' },
    user: { id: 'user-1' },
    config: { modelSpecs: { list: [{ default: true, preset: { model: 'gpt-4o' } }] } },
  };
  const res = response();
  let continued = false;
  await middleware(req, res, () => {
    continued = true;
  });

  assert.equal(continued, false);
  assert.equal(res.statusCode, 409);
  assert.equal(res.payload.error, 'WORK_AUTO_UNRESOLVED');
});

test('seeds before the handler runs, so a later failure still leaves a marked row', async () => {
  const order = [];
  const middleware = workContextMiddleware(
    async () => ({ ollama: [{ model: 'llama3:latest' }] }),
    () => 'llama3:latest',
    async (_req, context) => {
      order.push('seed:' + context.workModel);
    },
  );
  await middleware(
    { body: { text: 'plan', model: 'auto', conversationId: 'c-1' }, user: { id: 'u' } },
    response(),
    () => order.push('handler'),
  );

  assert.deepEqual(order, ['seed:llama3:latest', 'handler']);
});

test('a follow-up on an existing conversation keeps its original marker', async () => {
  const db = fakeDb({ conversationId: 'convo-1', isWork: true, workModel: 'llama3:latest' });
  const result = await seedWorkConversation(
    { user: { id: 'user-1' }, body: { conversationId: 'convo-1' } },
    { isWork: true, workModel: 'qwen2.5' },
    db,
  );

  assert.deepEqual(result, { seeded: false, reason: 'exists' });
  assert.equal(db.saves.length, 0);
});

test('delegates to the native agents router under /chat', async () => {
  const calls = [];
  const delegate = delegateToAgents((req, _res, next) => {
    calls.push({ url: req.url, model: req.body?.model });
    next();
  });
  const req = { url: '/', body: { model: 'llama3:latest' } };
  let continued = false;
  await delegate(req, {}, () => {
    continued = true;
  });

  assert.deepEqual(calls, [{ url: '/chat', model: 'llama3:latest' }]);
  assert.equal(req.url, '/');
  assert.equal(continued, true);
});

test('forwards subpaths such as resume and approvals under /chat', async () => {
  const seen = [];
  const delegate = delegateToAgents((req, _res, next) => {
    seen.push(req.url);
    next();
  });

  for (const path of ['/resume', '/approve']) {
    const req = { url: path };
    await delegate(req, {}, () => {});
    assert.equal(req.url, path, 'path is restored after delegation');
  }
  assert.deepEqual(seen, ['/chat/resume', '/chat/approve']);
});

test('propagates a downstream error after restoring the path', async () => {
  const failure = new Error('downstream');
  const delegate = delegateToAgents((_req, _res, next) => next(failure));
  const req = { url: '/' };
  const received = await new Promise((resolve) => {
    delegate(req, {}, (err) => resolve(err));
  });

  assert.equal(received, failure);
  assert.equal(req.url, '/');
});

/** Serves one express app on an ephemeral port and returns the base URL. */
function serve(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app).listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

test('/api/work/chat runs the native path and passes the selected model and provider', async () => {
  const seen = [];
  const fakeAgents = (req, res) => {
    seen.push({
      url: req.url,
      workModel: req.workContext?.workModel,
      model: req.body?.model,
      endpoint: req.body?.endpoint,
    });
    res.status(200).json({ ok: true });
  };

  const app = express();
  app.use(express.json());
  app.use('/api/work', (req, _res, next) => {
    req.user = { id: 'user-1' };
    next();
  });
  app.use(
    '/api/work',
    createWorkApiRouter({
      chatRouter: createWorkChatRouter({
        loadModelsForRequest: async () => ({ ollama: [{ model: 'llama3:latest' }] }),
        configuredDefaultModel: () => 'llama3:latest',
        seedConversation: async () => ({ seeded: true }),
        agentsRouter: fakeAgents,
      }),
      createReadRouterForRequest: () => express.Router(),
    }),
  );

  const { server, port } = await serve(app);
  try {
    const response = await fetch('http://127.0.0.1:' + port + '/api/work/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'plan', model: 'auto', isWork: true, workModel: 'gpt-4o' }),
    });
    const responseText = await response.text();

    assert.equal(response.status, 200, responseText);
    assert.deepEqual(JSON.parse(responseText), { ok: true });
    assert.equal(seen.length, 1, 'the native handler ran exactly once');
    assert.equal(seen[0].url, '/chat', 'admission receives the native chat path');
    assert.equal(seen[0].workModel, 'llama3:latest', 'Work context set before admission');
    assert.equal(seen[0].model, 'llama3:latest', 'the concrete model reaches the runner');
    assert.equal(seen[0].endpoint, 'ollama', 'the selected model provider reaches the runner');
  } finally {
    server.close();
  }
});

test('/api/work/chat refuses a paid model before any native admission runs', async () => {
  let reached = false;
  const app = express();
  app.use(express.json());
  app.use('/api/work', (req, _res, next) => {
    req.user = { id: 'user-1' };
    next();
  });
  app.use(
    '/api/work',
    createWorkApiRouter({
      chatRouter: createWorkChatRouter({
        loadModelsForRequest: async () => ({ openAI: [{ model: 'gpt-4o' }] }),
        configuredDefaultModel: () => 'gpt-4o',
        seedConversation: async () => ({ seeded: false }),
        agentsRouter: (_req, res) => {
          reached = true;
          res.status(200).json({ ok: true });
        },
      }),
      createReadRouterForRequest: () => express.Router(),
    }),
  );

  const { server, port } = await serve(app);
  try {
    const response = await fetch('http://127.0.0.1:' + port + '/api/work/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'plan', model: 'gpt-4o' }),
    });
    const responseText = await response.text();

    assert.equal(response.status, 409, responseText);
    const body = JSON.parse(responseText);
    assert.equal(body.error, 'WORK_MODEL_NOT_ALLOWED');
    assert.equal(reached, false, 'the native chain never ran for a refused model');
  } finally {
    server.close();
  }
});

const agentContextMiddleware = (findAgent, configuredDefault = null) =>
  workContextMiddleware(
    async () => ({ ollama: [{ model: 'llama3:latest' }], openAI: [{ model: 'gpt-4o' }] }),
    () => configuredDefault,
    async () => ({ seeded: false }),
    findAgent,
  );

test('keeps the selected native agent and its own model on the Work path', async () => {
  const middleware = agentContextMiddleware(async (id) => ({
    id,
    model: 'llama3:latest',
    provider: 'ollama',
  }));
  const req = {
    body: { text: 'plan', model: 'auto', endpoint: 'agents', agent_id: 'agent-plan' },
    user: { id: 'user-1' },
  };
  const res = response();
  let continued = false;
  await middleware(req, res, () => {
    continued = true;
  });

  assert.equal(continued, true);
  assert.deepEqual(req.workContext, {
    isWork: true,
    workModel: 'llama3:latest',
    workProvider: 'ollama',
  });
  assert.equal(req.body.model, 'llama3:latest');
  assert.equal(req.body.endpoint, 'agents', 'the native agent endpoint reaches the runner');
  assert.equal(req.body.agent_id, 'agent-plan');
});

test('honours an explicit model when it matches the selected native agent', async () => {
  const middleware = agentContextMiddleware(async (id) => ({
    id,
    model: 'llama3:latest',
    provider: 'ollama',
  }));
  const req = {
    body: { text: 'plan', model: 'llama3:latest', endpoint: 'agents', agent_id: 'agent-plan' },
    user: { id: 'user-1' },
  };
  const res = response();
  let continued = false;
  await middleware(req, res, () => {
    continued = true;
  });

  assert.equal(continued, true);
  assert.equal(req.workContext.workModel, 'llama3:latest');
  assert.equal(req.body.model, 'llama3:latest');
});

test('rejects a requested model that differs from the selected agent model', async () => {
  const middleware = agentContextMiddleware(async (id) => ({
    id,
    model: 'llama3:latest',
    provider: 'ollama',
  }));
  const req = {
    body: { text: 'plan', model: 'gpt-4o', endpoint: 'agents', agent_id: 'agent-plan' },
    user: { id: 'user-1' },
  };
  const res = response();
  let continued = false;
  await middleware(req, res, () => {
    continued = true;
  });

  assert.equal(continued, false);
  assert.equal(res.statusCode, 409);
  assert.equal(res.payload.error, 'WORK_MODEL_NOT_ALLOWED');
});

test('refuses an agent whose own model is paid even when the request names a free model', async () => {
  const middleware = agentContextMiddleware(async (id) => ({
    id,
    model: 'gpt-4o',
    provider: 'openAI',
  }));
  const req = {
    body: { text: 'plan', model: 'llama3:latest', endpoint: 'agents', agent_id: 'agent-paid' },
    user: { id: 'user-1' },
  };
  const res = response();
  let continued = false;
  await middleware(req, res, () => {
    continued = true;
  });

  assert.equal(continued, false);
  assert.equal(res.statusCode, 409);
  assert.equal(res.payload.error, 'WORK_MODEL_NOT_ALLOWED');
});

test('refuses an agent that claims a local model on a paid provider', async () => {
  const middleware = agentContextMiddleware(async (id) => ({
    id,
    model: 'llama3:latest',
    provider: 'openAI',
  }));
  const req = {
    body: { text: 'plan', model: 'llama3:latest', endpoint: 'agents', agent_id: 'agent-spoofed' },
    user: { id: 'user-1' },
  };
  const res = response();
  let continued = false;
  await middleware(req, res, () => {
    continued = true;
  });

  assert.equal(continued, false);
  assert.equal(res.statusCode, 409);
  assert.equal(res.payload.error, 'WORK_MODEL_NOT_ALLOWED');
});

test('reports an unavailable selected agent instead of running a different one', async () => {
  const middleware = agentContextMiddleware(async () => null);
  const req = {
    body: { text: 'plan', model: 'llama3:latest', endpoint: 'agents', agent_id: 'agent-gone' },
    user: { id: 'user-1' },
  };
  const res = response();
  let continued = false;
  await middleware(req, res, () => {
    continued = true;
  });

  assert.equal(continued, false);
  assert.equal(res.statusCode, 404);
  assert.equal(res.payload.error, 'WORK_AGENT_NOT_FOUND');
});

test('reports an agent lookup failure as unavailable', async () => {
  const middleware = agentContextMiddleware(async () => {
    throw new Error('agent store down');
  });
  const req = {
    body: { text: 'plan', model: 'llama3:latest', endpoint: 'agents', agent_id: 'agent-plan' },
    user: { id: 'user-1' },
  };
  const res = response();
  let continued = false;
  await middleware(req, res, () => {
    continued = true;
  });

  assert.equal(continued, false);
  assert.equal(res.statusCode, 503);
  assert.equal(res.payload.error, 'WORK_AGENT_UNAVAILABLE');
});

test('/api/work/chat keeps the selected agent on the native path', async () => {
  const seen = [];
  const fakeAgents = (req, res) => {
    seen.push({
      url: req.url,
      endpoint: req.body?.endpoint,
      agent_id: req.body?.agent_id,
      model: req.body?.model,
    });
    res.status(200).json({ ok: true });
  };

  const app = express();
  app.use(express.json());
  app.use('/api/work', (req, _res, next) => {
    req.user = { id: 'user-1' };
    next();
  });
  app.use(
    '/api/work',
    createWorkApiRouter({
      chatRouter: createWorkChatRouter({
        loadModelsForRequest: async () => ({ ollama: [{ model: 'llama3:latest' }] }),
        configuredDefaultModel: () => null,
        seedConversation: async () => ({ seeded: true }),
        findAgent: async (id) => ({ id, model: 'llama3:latest', provider: 'ollama' }),
        authorizeAgent: (_req, _res, next) => next(),
        agentsRouter: fakeAgents,
      }),
      createReadRouterForRequest: () => express.Router(),
    }),
  );

  const { server, port } = await serve(app);
  try {
    const response = await fetch('http://127.0.0.1:' + port + '/api/work/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: 'plan',
        model: 'auto',
        endpoint: 'agents',
        agent_id: 'agent-plan',
      }),
    });
    const responseText = await response.text();

    assert.equal(response.status, 200, responseText);
    assert.deepEqual(JSON.parse(responseText), { ok: true });
    assert.deepEqual(seen, [
      {
        url: '/chat',
        endpoint: 'agents',
        agent_id: 'agent-plan',
        model: 'llama3:latest',
      },
    ]);
  } finally {
    server.close();
  }
});

test('/api/work/chat checks access to the selected agent before reading its model', async () => {
  const findAgent = async (id) => ({ id, model: 'llama3:latest', provider: 'ollama' });
  let findAgentCalls = 0;
  const findAgentSpy = async (id) => {
    findAgentCalls += 1;
    return findAgent(id);
  };
  const seen = [];
  const app = express();
  app.use(express.json());
  app.use('/api/work', (req, _res, next) => {
    req.user = { id: 'user-2' };
    next();
  });
  app.use(
    '/api/work',
    createWorkApiRouter({
      chatRouter: createWorkChatRouter({
        loadModelsForRequest: async () => ({ ollama: [{ model: 'llama3:latest' }] }),
        configuredDefaultModel: () => null,
        seedConversation: async () => ({ seeded: false }),
        findAgent: findAgentSpy,
        authorizeAgent: (_req, res) => res.status(403).json({ error: 'Forbidden' }),
        agentsRouter: (req, res) => {
          seen.push(req.body.agent_id);
          res.status(200).json({ ok: true });
        },
      }),
      createReadRouterForRequest: () => express.Router(),
    }),
  );

  const { server, port } = await serve(app);
  try {
    const response = await fetch('http://127.0.0.1:' + port + '/api/work/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: 'plan',
        model: 'auto',
        agent_id: 'agent-private',
      }),
    });

    const responseText = await response.text();
    assert.equal(response.status, 403, responseText);
    assert.deepEqual(JSON.parse(responseText), { error: 'Forbidden' });
    assert.equal(findAgentCalls, 0);
    assert.deepEqual(seen, []);
  } finally {
    server.close();
  }
});

test('Work model reads skip chat-only model resolution', async () => {
  let loadedChatModels = false;
  const chatRouter = createWorkChatRouter({
    loadModelsForRequest: async () => {
      loadedChatModels = true;
      throw new Error('chat model config unavailable');
    },
    agentsRouter: (_req, res) => res.status(200).json({ ok: true }),
  });
  const readRouter = express.Router();
  readRouter.get('/models', (_req, res) => res.status(200).json({ models: [] }));

  const app = express();
  app.use(
    '/api/work',
    createWorkApiRouter({
      chatRouter,
      createReadRouterForRequest: () => readRouter,
    }),
  );
  const { server, port } = await serve(app);
  try {
    const response = await fetch('http://127.0.0.1:' + port + '/api/work/models');
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '{"models":[]}');
    assert.equal(loadedChatModels, false);
  } finally {
    server.close();
  }
});
