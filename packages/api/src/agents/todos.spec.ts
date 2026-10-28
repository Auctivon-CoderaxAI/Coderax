import type { DynamicStructuredTool } from '@librechat/agents/langchain/tools';
import type { AppConfig } from '@coderax/data-schemas';
import type { TodoItem } from './todos';
import {
  MAX_TODOS,
  WRITE_TODOS_TOOL,
  WriteTodosToolDefinition,
  createTodoTools,
  describeTodos,
  isWriteTodosAdminDisabled,
  normalizeTodos,
  writeTodos,
} from './todos';

function todo(content: string, status: TodoItem['status'] = 'pending'): TodoItem {
  return { content, status };
}

async function invokeWrite(todos: unknown): Promise<Record<string, unknown>> {
  const [writeTodo] = createTodoTools() as unknown as Array<DynamicStructuredTool<unknown>>;
  const result = await writeTodo.invoke({ todos } as never);
  return JSON.parse(result as string) as Record<string, unknown>;
}

describe('normalizeTodos', () => {
  test('trims and collapses whitespace in item content', () => {
    expect(normalizeTodos([todo('  Run\n the   tests  ')])).toEqual([
      { content: 'Run the tests', status: 'pending' },
    ]);
  });

  test('drops blank items instead of rejecting the write', () => {
    expect(normalizeTodos([todo('   '), todo('Ship it', 'completed')])).toEqual([
      { content: 'Ship it', status: 'completed' },
    ]);
  });

  test('de-duplicates by content, keeping the later status', () => {
    expect(normalizeTodos([todo('Run the tests'), todo('Run the tests', 'in_progress')])).toEqual([
      { content: 'Run the tests', status: 'in_progress' },
    ]);
  });

  test('caps the list at the maximum', () => {
    const many = Array.from({ length: MAX_TODOS + 5 }, (_, index) => todo(`Item ${index}`));
    expect(normalizeTodos(many)).toHaveLength(MAX_TODOS);
  });
});

describe('describeTodos', () => {
  test('reports progress by completed count', () => {
    expect(describeTodos([todo('a', 'completed'), todo('b'), todo('c')])).toBe('1 of 3 done');
  });

  test('adds in-progress and cancelled counts when present', () => {
    expect(
      describeTodos([todo('a', 'completed'), todo('b', 'in_progress'), todo('c', 'cancelled')]),
    ).toBe('1 of 3 done, 1 in progress, 1 cancelled');
  });

  test('describes an empty plan', () => {
    expect(describeTodos([])).toBe('No plan items.');
  });
});

describe('writeTodos', () => {
  test('echoes the normalized list with counts and summary', () => {
    const result = writeTodos([todo('a', 'completed'), todo('b', 'in_progress')]);
    expect(result.todos).toEqual([
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'in_progress' },
    ]);
    expect(result.counts).toEqual({ pending: 0, in_progress: 1, completed: 1, cancelled: 0 });
    expect(result.summary).toBe('1 of 2 done, 1 in progress');
  });
});

describe('createTodoTools', () => {
  test('exposes a single write_todos tool with a matching definition', () => {
    const created = createTodoTools();
    expect(created).toHaveLength(1);
    expect(created[0]?.name).toBe(WRITE_TODOS_TOOL);
    expect(WriteTodosToolDefinition.name).toBe(WRITE_TODOS_TOOL);
    expect(WriteTodosToolDefinition.schema.properties.todos.items.required).toEqual([
      'content',
      'status',
    ]);
  });

  test('returns the stored plan as JSON for the model to read back', async () => {
    const parsed = await invokeWrite([todo('Run the focused tests', 'in_progress')]);
    expect(parsed.todos).toEqual([{ content: 'Run the focused tests', status: 'in_progress' }]);
    expect(parsed.counts).toEqual({ pending: 0, in_progress: 1, completed: 0, cancelled: 0 });
  });

  test('rejects a status outside the allowed set', async () => {
    await expect(invokeWrite([todo('Run the tests', 'blocked' as never)])).rejects.toBeDefined();
  });
});

describe('isWriteTodosAdminDisabled', () => {
  test('is disabled when the allowlist omits it', () => {
    expect(isWriteTodosAdminDisabled({ includedTools: ['web_search'] } as AppConfig)).toBe(true);
  });

  test('is enabled when the allowlist includes it', () => {
    expect(isWriteTodosAdminDisabled({ includedTools: [WRITE_TODOS_TOOL] } as AppConfig)).toBe(
      false,
    );
  });

  test('is disabled by the exclude list', () => {
    expect(isWriteTodosAdminDisabled({ filteredTools: [WRITE_TODOS_TOOL] } as AppConfig)).toBe(
      true,
    );
  });

  test('is enabled with no filter configured', () => {
    expect(isWriteTodosAdminDisabled(undefined)).toBe(false);
  });
});
