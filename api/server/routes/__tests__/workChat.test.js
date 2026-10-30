const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveWorkContext,
  stripClientWorkFields,
  workContextMiddleware,
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

test('auto resolves through the configured default when it is offered', () => {
  assert.deepEqual(resolveWorkContext([PAID, FREE, LOCAL], 'auto', 'llama3:latest'), {
    isWork: true,
    workModel: 'llama3:latest',
  });
  assert.deepEqual(resolveWorkContext([PAID, FREE, LOCAL], 'auto', 'free/alpha'), {
    isWork: true,
    workModel: 'free/alpha',
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
  );
  const req = { body: { text: 'plan', model: 'auto', isWork: true, workModel: 'gpt-4o' }, user: {} };
  const res = response();
  let continued = false;
  await middleware(req, res, () => {
    continued = true;
  });

  assert.equal(continued, true);
  assert.deepEqual(req.workContext, { isWork: true, workModel: 'llama3:latest' });
  assert.equal(req.body.isWork, undefined);
  assert.equal(req.body.workModel, undefined);
  assert.equal(req.body.text, 'plan');
});

test('the alias hands the handler the concrete model, never the auto sentinel', async () => {
  const middleware = workContextMiddleware(
    async () => ({ ollama: [{ model: 'llama3:latest' }] }),
    () => 'llama3:latest',
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
});

test('an omitted model resolves through the configured default', async () => {
  const middleware = workContextMiddleware(
    async () => ({ ollama: [{ model: 'llama3:latest' }], lmstudio: ['qwen2.5'] }),
    () => 'qwen2.5',
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
