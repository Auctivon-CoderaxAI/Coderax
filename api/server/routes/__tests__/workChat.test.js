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

test('auto resolves to a concrete local model, never the sentinel', () => {
  assert.deepEqual(resolveWorkContext([PAID, FREE, LOCAL], 'auto'), {
    isWork: true,
    workModel: 'llama3:latest',
  });
});

test('auto still resolves when only a free gateway model exists', () => {
  assert.deepEqual(resolveWorkContext([PAID, FREE], 'auto'), {
    isWork: true,
    workModel: 'free/alpha',
  });
});

test('auto without any free or local model fails instead of falling back to paid', () => {
  assert.deepEqual(resolveWorkContext([PAID], 'auto'), { error: 'WORK_NO_FREE_MODEL' });
  assert.deepEqual(resolveWorkContext([], 'auto'), { error: 'WORK_NO_FREE_MODEL' });
  assert.deepEqual(resolveWorkContext(undefined, 'auto'), { error: 'WORK_NO_FREE_MODEL' });
});

test('a paid model request is refused rather than silently swapped', () => {
  assert.deepEqual(resolveWorkContext([PAID, LOCAL], 'gpt-4o'), {
    error: 'WORK_MODEL_NOT_ALLOWED',
  });
  assert.deepEqual(resolveWorkContext([PAID, LOCAL], 'no-such-model'), {
    error: 'WORK_MODEL_NOT_ALLOWED',
  });
});

test('an allowed pick is kept as the concrete model', () => {
  assert.deepEqual(resolveWorkContext([PAID, LOCAL, FREE], 'free/alpha'), {
    isWork: true,
    workModel: 'free/alpha',
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

test('the alias middleware sets server-owned context and strips client claims', async () => {
  const middleware = workContextMiddleware(async () => ({ ollama: [{ model: 'llama3:latest' }] }));
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

test('the alias middleware refuses a paid model before the chat handler runs', async () => {
  const middleware = workContextMiddleware(async () => ({ openAI: [{ model: 'gpt-4o' }] }));
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
