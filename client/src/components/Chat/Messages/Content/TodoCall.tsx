import { CheckCircle2, Circle, CircleSlash, ListChecks, LoaderCircle } from 'lucide-react';
import type { TranslationKeys } from '~/hooks';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/**
 * Mirrors `WRITE_TODOS_TOOL` in `packages/api/src/agents/todos.ts`. The client
 * cannot import backend code, so the string is duplicated for the same reason
 * `ask_user_question` is: the part dispatch and the card key on one name.
 */
export const WRITE_TODOS_TOOL = 'write_todos';

const TODO_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'] as const;

type TodoStatus = (typeof TODO_STATUSES)[number];

interface TodoItem {
  content: string;
  status: TodoStatus;
}

function isTodoStatus(value: unknown): value is TodoStatus {
  return typeof value === 'string' && (TODO_STATUSES as readonly string[]).includes(value);
}

/**
 * Parse a `write_todos` call's args into the checklist. Returns `null` while the
 * args are still streaming (partial JSON never parses) so the caller can fall
 * back to the generic preparing row instead of rendering a half-written plan.
 * A list that fails validation is also `null`: showing a plan the tool rejected
 * would be worse than showing none.
 */
export function parseTodoArgs(
  args: string | Record<string, unknown> | undefined,
): TodoItem[] | null {
  if (args == null) {
    return null;
  }
  let parsed: unknown = args;
  if (typeof args === 'string') {
    if (args.trim().length === 0) {
      return null;
    }
    try {
      parsed = JSON.parse(args);
    } catch {
      return null;
    }
  }
  if (typeof parsed !== 'object' || parsed === null || !('todos' in parsed)) {
    return null;
  }
  const rawTodos = (parsed as { todos?: unknown }).todos;
  if (!Array.isArray(rawTodos)) {
    return null;
  }
  const todos: TodoItem[] = [];
  for (const entry of rawTodos) {
    if (typeof entry !== 'object' || entry === null) {
      return null;
    }
    const { content, status } = entry as { content?: unknown; status?: unknown };
    if (typeof content !== 'string' || content.trim().length === 0 || !isTodoStatus(status)) {
      return null;
    }
    todos.push({ content: content.trim(), status });
  }
  return todos;
}

function statusLabelKey(status: TodoStatus): TranslationKeys {
  switch (status) {
    case 'completed':
      return 'com_ui_plan_status_completed';
    case 'in_progress':
      return 'com_ui_plan_status_in_progress';
    case 'cancelled':
      return 'com_ui_plan_status_cancelled';
    default:
      return 'com_ui_plan_status_pending';
  }
}

function StatusGlyph({ status }: { status: TodoStatus }) {
  const shared = 'mt-0.5 size-4 shrink-0';
  switch (status) {
    case 'completed':
      return <CheckCircle2 className={cn(shared, 'text-status-success')} aria-hidden="true" />;
    case 'in_progress':
      return (
        <LoaderCircle
          className={cn(shared, 'text-text-primary motion-safe:animate-spin')}
          aria-hidden="true"
        />
      );
    case 'cancelled':
      return <CircleSlash className={cn(shared, 'text-text-tertiary')} aria-hidden="true" />;
    default:
      return <Circle className={cn(shared, 'text-text-secondary')} aria-hidden="true" />;
  }
}

function contentClass(status: TodoStatus): string {
  if (status === 'completed') {
    return 'text-text-secondary';
  }
  if (status === 'cancelled') {
    return 'text-text-tertiary line-through';
  }
  if (status === 'in_progress') {
    return 'text-text-primary font-medium';
  }
  return 'text-text-primary';
}

/**
 * The plan the model keeps current during a turn. Unlike a tool call, this is
 * the reader's progress view for the whole turn, so it stays open: collapsing it
 * would hide the only place the plan is written down. Every item is
 * model-authored and rendered as a text node.
 */
export default function TodoCall({ args }: { args: string | Record<string, unknown> | undefined }) {
  const localize = useLocalize();
  const todos = parseTodoArgs(args);
  if (todos == null || todos.length === 0) {
    return null;
  }
  const completed = todos.filter((todo) => todo.status === 'completed').length;

  return (
    <div
      className="border-border-light bg-surface-secondary my-2 w-full rounded-lg border p-3"
      data-testid="todo-call"
    >
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <ListChecks className="text-text-secondary size-4 shrink-0" aria-hidden="true" />
        <span className="text-text-primary text-sm font-medium">{localize('com_ui_plan')}</span>
        <span className="text-text-secondary text-xs">
          {localize('com_ui_plan_progress', {
            0: String(completed),
            1: String(todos.length),
          })}
        </span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {todos.map((todo, index) => (
          <li key={`${index}-${todo.content}`} className="flex items-start gap-2">
            <StatusGlyph status={todo.status} />
            <span
              className={cn(
                'text-sm leading-relaxed [overflow-wrap:anywhere]',
                contentClass(todo.status),
              )}
            >
              {todo.content}
            </span>
            <span className="sr-only">{localize(statusLabelKey(todo.status))}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
