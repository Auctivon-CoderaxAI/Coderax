import { z } from 'zod';
import { tool } from '@librechat/agents/langchain/tools';
import type { AppConfig } from '@coderax/data-schemas';
import type { GenericTool } from '@librechat/agents';

/**
 * Tool name. Shared verbatim with the client card that renders the checklist,
 * the same way `ask_user_question` keys its whole pipeline on one string.
 */
export const WRITE_TODOS_TOOL = 'write_todos';

export const TODO_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'] as const;

export type TodoStatus = (typeof TODO_STATUSES)[number];

export interface TodoItem {
  content: string;
  status: TodoStatus;
}

export interface TodoCounts {
  pending: number;
  in_progress: number;
  completed: number;
  cancelled: number;
}

export interface TodoWriteResult {
  todos: TodoItem[];
  counts: TodoCounts;
  /** Human-readable progress line, also what the model reads back after a write. */
  summary: string;
  /** One-line reminder of the contract, so the model keeps the list current. */
  next: string;
}

/** Bounds double as the sanitization story: every item is model-generated and
 *  rendered verbatim (as a React text node) in the plan card. */
const CONTENT_MAX = 400;

/** Above this the list stops being a plan and becomes a data dump. */
export const MAX_TODOS = 50;

const TODO_STATUS_DESCRIPTION =
  'pending: not started. in_progress: the task being worked on now. ' +
  'completed: finished. cancelled: no longer needed.';

const WRITE_TODOS_DESCRIPTION = [
  'Create and update the plan for the current turn: send the ENTIRE list every time, in order,',
  'and replace it with the new list on each call (omitting an item removes it).',
  'Use it for work that needs three or more distinct steps, and update it as you go: mark the',
  'item you are working on as in_progress — keep at most one in_progress — and mark items',
  'completed the moment they are done, so the user can follow along.',
  'Send the list once before starting multi-step work, then again after each meaningful',
  'change; do not call it for a single trivial action, and never call it just to report',
  'progress in prose.',
  'The list is the plan the user sees in the chat, so keep items short, imperative and',
  'self-contained ("Run the focused Jest tests"), and keep the list under',
  `${MAX_TODOS} items.`,
].join(' ');

const todoItemSchema = z.object({
  content: z
    .string()
    .min(1)
    .max(CONTENT_MAX)
    .describe('Short imperative description of one task in the plan.'),
  status: z.enum(TODO_STATUSES).describe(TODO_STATUS_DESCRIPTION),
});

export const writeTodosSchema = z.object({
  todos: z
    .array(todoItemSchema)
    .max(MAX_TODOS)
    .describe(
      'The complete plan, in order. Every call replaces the previous list, so include ' +
        'already-completed items with status completed.',
    ),
});

export type WriteTodosInput = z.infer<typeof writeTodosSchema>;

/** JSON-schema twin of {@link writeTodosSchema}, for surfaces that carry the
 *  definition rather than the instance (the schema-only tool registry). */
export interface WriteTodosToolDefinitionShape {
  name: string;
  description: string;
  schema: {
    type: 'object';
    properties: {
      todos: {
        type: 'array';
        maxItems: number;
        description: string;
        items: {
          type: 'object';
          properties: {
            content: { type: 'string'; minLength: number; maxLength: number; description: string };
            status: { type: 'string'; enum: string[]; description: string };
          };
          required: string[];
        };
      };
    };
    required: string[];
  };
}

export const WriteTodosToolDefinition: WriteTodosToolDefinitionShape = {
  name: WRITE_TODOS_TOOL,
  description: WRITE_TODOS_DESCRIPTION,
  schema: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        maxItems: MAX_TODOS,
        description: 'The complete plan, in order. Every call replaces the previous list.',
        items: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              minLength: 1,
              maxLength: CONTENT_MAX,
              description: 'Short imperative description of one task in the plan.',
            },
            status: {
              type: 'string',
              enum: [...TODO_STATUSES],
              description: TODO_STATUS_DESCRIPTION,
            },
          },
          required: ['content', 'status'],
        },
      },
    },
    required: ['todos'],
  },
};

/** Trims model-authored text; blank content is dropped rather than rejected. */
function normalizeContent(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, CONTENT_MAX);
}

export function countTodos(todos: readonly TodoItem[]): TodoCounts {
  const counts: TodoCounts = { pending: 0, in_progress: 0, completed: 0, cancelled: 0 };
  for (const todo of todos) {
    counts[todo.status] += 1;
  }
  return counts;
}

/** `"2 of 5 done"`, plus the cancellations the total still counts. */
export function describeTodos(todos: readonly TodoItem[]): string {
  if (todos.length === 0) {
    return 'No plan items.';
  }
  const counts = countTodos(todos);
  const parts = [`${counts.completed} of ${todos.length} done`];
  if (counts.in_progress > 0) {
    parts.push(`${counts.in_progress} in progress`);
  }
  if (counts.cancelled > 0) {
    parts.push(`${counts.cancelled} cancelled`);
  }
  return parts.join(', ');
}

/**
 * Normalize a write into the stored shape: collapse whitespace, drop blank
 * items, and de-duplicate by content so a model that repeats an item does not
 * produce two rows the reader cannot tell apart. Later statuses win, matching
 * the replace-the-whole-list contract.
 */
export function normalizeTodos(todos: readonly TodoItem[]): TodoItem[] {
  const byContent = new Map<string, TodoItem>();
  for (const todo of todos.slice(0, MAX_TODOS)) {
    const content = normalizeContent(todo.content);
    if (content.length === 0) {
      continue;
    }
    const previous = byContent.get(content);
    if (previous != null) {
      previous.status = todo.status;
      continue;
    }
    byContent.set(content, { content, status: todo.status });
  }
  return Array.from(byContent.values());
}

export function writeTodos(todos: readonly TodoItem[]): TodoWriteResult {
  const normalized = normalizeTodos(todos);
  return {
    todos: normalized,
    counts: countTodos(normalized),
    summary: describeTodos(normalized),
    next: 'Keep the list current: mark the active item in_progress and finished items completed.',
  };
}

/**
 * Create the `write_todos` tool. It is stateless on purpose: the arguments carry
 * the whole list, and the result echoes the normalized list back so the model
 * reads the same plan the user sees. State lives in the conversation history,
 * which is also what survives a reload.
 */
export function createTodoTools(): GenericTool[] {
  const write = tool(async ({ todos }: WriteTodosInput) => JSON.stringify(writeTodos(todos)), {
    name: WRITE_TODOS_TOOL,
    description: WRITE_TODOS_DESCRIPTION,
    schema: writeTodosSchema,
  });

  return [write];
}

/**
 * Admin kill switch, mirroring `isAskUserQuestionAdminDisabled`: the
 * `includedTools` allowlist wins over `filteredTools`, and an agent-facing plan
 * tool an operator cannot switch off would be a lever they do not control.
 */
export function isWriteTodosAdminDisabled(appConfig?: AppConfig): boolean {
  const included = appConfig?.includedTools;
  if (included != null && included.length > 0) {
    return !included.includes(WRITE_TODOS_TOOL);
  }
  return appConfig?.filteredTools?.includes(WRITE_TODOS_TOOL) === true;
}
