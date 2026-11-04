const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkDepsFactory } = require('../workDeps');

const WORK_ROW = {
  conversationId: 'c-1',
  title: 'Plan',
  isWork: true,
  workModel: 'llama3:latest',
  workState: 'completed',
};
const CHAT_ROW = { conversationId: 'c-2', title: 'Chat', isWork: false };

function makeDeps(overrides = {}) {
  const calls = { cursor: [], abort: [], warns: [] };
  const db = {
    getConvosByCursor: async (userId, options) => {
      calls.cursor.push({ userId, options });
      return { conversations: [WORK_ROW, CHAT_ROW], nextCursor: null };
    },
    getConvo: async () => WORK_ROW,
    ...overrides.db,
  };
  const jobs = {
    getJob: async () => ({ userId: 'user-1', tenantId: 'tenant-a', createdAt: 42 }),
    getJobStatus: async () => 'complete',
    abortJob: async (conversationId, options) => {
      calls.abort.push([conversationId, options]);
      return { success: true };
    },
    ...overrides.jobs,
  };
  const factory = createWorkDepsFactory({
    db,
    jobs,
    loadModels: async () => ({ ollama: [{ model: 'llama3:latest', name: 'Llama 3' }] }),
    workStateForJobStatus: (status) =>
      ({ complete: 'completed', error: 'failed', aborted: 'cancelled' })[status] ?? null,
    logger: { warn: (message) => calls.warns.push(message) },
  });

  return { depsFor: factory, calls };
}

test('model discovery flattens the native catalog and keeps local models', async () => {
  const { depsFor } = makeDeps();
  const deps = depsFor({ user: { id: 'user-1' } });

  assert.deepEqual(await deps.listModels(), [
    { id: 'llama3:latest', label: 'Llama 3', provider: 'ollama', local: true },
  ]);
});

test('history reads this owner newest-first and keeps only Work conversations', async () => {
  const { depsFor, calls } = makeDeps();
  const deps = depsFor({ user: { id: 'user-1' } });

  const rows = await deps.listConversations({ userId: 'user-1', limit: 50 });

  assert.deepEqual(calls.cursor, [
    {
      userId: 'user-1',
      options: {
        limit: 50,
        isArchived: false,
        sortBy: 'updatedAt',
        sortDirection: 'desc',
      },
    },
  ]);
  assert.deepEqual(
    rows.map((row) => row.conversationId),
    ['c-1'],
  );
});

test('a single conversation is read through the owner-scoped store', async () => {
  let read;
  const { depsFor } = makeDeps({
    db: {
      getConvo: async (userId, conversationId) => {
        read = { userId, conversationId };
        return WORK_ROW;
      },
    },
  });
  const deps = depsFor({ user: { id: 'user-1' } });

  const conversation = await deps.getConversation({
    userId: 'user-1',
    conversationId: 'c-1',
  });

  assert.deepEqual(read, { userId: 'user-1', conversationId: 'c-1' });
  assert.equal(conversation.isWork, true);
  assert.equal(conversation.workModel, 'llama3:latest');
});

test('run state comes from the native job status, never from an inferred value', async () => {
  const { depsFor } = makeDeps({ jobs: { getJobStatus: async () => 'complete' } });
  const deps = depsFor({ user: { id: 'user-1' } });

  assert.equal(await deps.getRunState({ conversationId: 'c-1' }), 'completed');
});

test('a missing native job has nothing to cancel', async () => {
  const { depsFor, calls } = makeDeps({ jobs: { getJob: async () => null } });
  const deps = depsFor({ user: { id: 'user-1', tenantId: 'tenant-a' } });

  assert.equal(await deps.cancelRun({ userId: 'user-1', conversationId: 'c-1' }), false);
  assert.equal(calls.abort.length, 0);
});

test('another user’s job is refused before the abort is attempted', async () => {
  const { depsFor, calls } = makeDeps({
    jobs: { getJob: async () => ({ userId: 'user-2', tenantId: 'tenant-a', createdAt: 7 }) },
  });
  const deps = depsFor({ user: { id: 'user-1', tenantId: 'tenant-a' } });

  assert.equal(await deps.cancelRun({ userId: 'user-1', conversationId: 'c-1' }), false);
  assert.equal(calls.abort.length, 0);
  assert.match(calls.warns[0], /another user/);
});

test('another tenant’s job is refused before the abort is attempted', async () => {
  const { depsFor, calls } = makeDeps({
    jobs: { getJob: async () => ({ userId: 'user-1', tenantId: 'tenant-b', createdAt: 7 }) },
  });
  const deps = depsFor({ user: { id: 'user-1', tenantId: 'tenant-a' } });

  assert.equal(await deps.cancelRun({ userId: 'user-1', conversationId: 'c-1' }), false);
  assert.equal(calls.abort.length, 0);
  assert.match(calls.warns[0], /another tenant/);
});

test('the request tenant is used when the user object carries none', async () => {
  const { depsFor, calls } = makeDeps({
    jobs: { getJob: async () => ({ userId: 'user-1', tenantId: 'tenant-b', createdAt: 7 }) },
  });
  const deps = depsFor({ user: { id: 'user-1' }, tenantId: 'tenant-a' });

  assert.equal(await deps.cancelRun({ userId: 'user-1', conversationId: 'c-1' }), false);
  assert.equal(calls.abort.length, 0);
  assert.match(calls.warns[0], /another tenant/);
});

test('the owner’s cancel carries the job creation time and reports the abort result', async () => {
  const { depsFor, calls } = makeDeps();
  const deps = depsFor({ user: { id: 'user-1', tenantId: 'tenant-a' } });

  assert.equal(await deps.cancelRun({ userId: 'user-1', conversationId: 'c-1' }), true);
  assert.deepEqual(calls.abort, [['c-1', { expectedCreatedAt: 42 }]]);
  assert.equal(calls.warns.length, 0);
});

test('an abort the manager did not win is reported as not cancelled', async () => {
  const { depsFor } = makeDeps({ jobs: { abortJob: async () => ({ success: false }) } });
  const deps = depsFor({ user: { id: 'user-1', tenantId: 'tenant-a' } });

  assert.equal(await deps.cancelRun({ userId: 'user-1', conversationId: 'c-1' }), false);
});
