const test = require('node:test');
const assert = require('node:assert/strict');
const {
  flattenModelConfig,
  toWorkConversation,
  rowsFromCursor,
  onlyWorkRows,
  isLocalEndpoint,
} = require('../workModels');

test('tags locally served endpoints as local and keeps them', () => {
  const models = flattenModelConfig({
    ollama: [{ model: 'llama3:latest', name: 'Llama 3' }],
    lmstudio: ['qwen2.5'],
  });
  assert.deepEqual(models, [
    { id: 'llama3:latest', label: 'Llama 3', provider: 'ollama', local: true },
    { id: 'qwen2.5', label: 'qwen2.5', provider: 'lmstudio', local: true },
  ]);
});

test('leaves gateway models untagged so the free/local filter excludes them', () => {
  const models = flattenModelConfig({ openAI: [{ model: 'gpt-4o' }] });
  assert.deepEqual(models, [{ id: 'gpt-4o', label: 'gpt-4o', provider: 'openAI' }]);
});

test('does not trust a configured endpoint to mark its models as free', () => {
  assert.deepEqual(flattenModelConfig({ FreeOpenRouter: [{ id: 'free/alpha', free: true }] }), [
    { id: 'free/alpha', label: 'free/alpha', provider: 'FreeOpenRouter' },
  ]);
});

test('ignores entries with no usable id', () => {
  assert.deepEqual(flattenModelConfig({ openAI: [null, {}, { label: 'nameless' }] }), []);
  assert.deepEqual(flattenModelConfig(null), []);
});

test('detects local endpoints case-insensitively', () => {
  assert.equal(isLocalEndpoint('OLLAMA'), true);
  assert.equal(isLocalEndpoint('openAI'), false);
});

test('maps a conversation and never infers Work from other fields', () => {
  assert.deepEqual(
    toWorkConversation({
      conversationId: 'c-1',
      title: 'Plan',
      isWork: true,
      workModel: 'llama3:latest',
      workState: 'completed',
    }),
    {
      conversationId: 'c-1',
      title: 'Plan',
      isWork: true,
      workModel: 'llama3:latest',
      workState: 'completed',
      createdAt: undefined,
      updatedAt: undefined,
    },
  );
  assert.equal(
    toWorkConversation({ conversationId: 'c-2', title: 'Chat', isWork: 'yes' }).isWork,
    false,
  );
  assert.equal(toWorkConversation({ conversationId: 'c-3' }).workState, undefined);
  assert.equal(toWorkConversation(null), null);
});

test('reads conversation rows from either cursor shape', () => {
  assert.deepEqual(rowsFromCursor([{ conversationId: 'a' }]), [{ conversationId: 'a' }]);
  assert.deepEqual(rowsFromCursor({ conversations: [{ conversationId: 'b' }] }), [
    { conversationId: 'b' },
  ]);
  assert.deepEqual(rowsFromCursor({}), []);
  assert.deepEqual(rowsFromCursor(undefined), []);
});

test('history keeps Work conversations only', () => {
  const rows = [
    { conversationId: 'a', title: 'Plan', isWork: true },
    { conversationId: 'b', title: 'Chat', isWork: false },
    { conversationId: 'c', title: 'Other' },
    null,
  ];
  assert.deepEqual(
    onlyWorkRows(rows).map((row) => row.conversationId),
    ['a'],
  );
  assert.deepEqual(onlyWorkRows(undefined), []);
  assert.deepEqual(onlyWorkRows([]), []);
});
