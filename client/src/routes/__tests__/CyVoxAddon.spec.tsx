import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import ConversationModeNav from '~/components/Chat/ConversationModeNav';
import CyVoxAddon from '../CyVoxAddon';

const mockLocalizedText: Record<string, string> = {
  com_cyvox_brand: 'Coderax',
  com_cyvox_chat: 'Chat',
  com_cyvox_conversation_mode: 'Conversation mode',
  com_cyvox_work: 'Work',
  com_cyvox_execution: 'Work style',
  com_cyvox_model: 'Model',
  com_cyvox_autonomous_run: 'Autonomous',
  com_cyvox_ai_team: 'AI team',
  com_cyvox_auto_model: 'Auto',
  com_cyvox_thinking_effort: 'Thinking effort',
  com_cyvox_effort_auto: 'Default',
  com_cyvox_effort_instant: 'Instant',
  com_cyvox_effort_medium: 'Medium',
  com_cyvox_effort_high: 'High',
  com_cyvox_effort_extra_high: 'Extra high',
  com_cyvox_task_selection_note: 'Model and thinking effort apply to this task only.',
  com_cyvox_team_selection_limit:
    'Team mode: delegated agents keep the deployment model until they inherit this selection.',
  com_cyvox_work_description_label: 'Describe what you want to get done',
  com_cyvox_work_description_placeholder: 'Tell me what you need to get done...',
  com_cyvox_work_welcome_title: 'What would you like to work on?',
  com_cyvox_work_welcome_description:
    'Describe the outcome you want. I’ll work through it and show progress here.',
  com_cyvox_work_recent_heading: 'Recent tasks',
  com_cyvox_work_task_status: 'Task status',
  com_cyvox_work_progress_note: 'Task updates and approval requests appear here.',
  com_cyvox_work_back_to_recent: 'Back to recent tasks',
  com_cyvox_work_start_task_aria: 'Start task',
  com_cyvox_start_work: 'Start task',
  com_cyvox_work_history_loading: 'Loading recent work…',
};

function ChatModeRoute() {
  const location = useLocation();
  return (
    <main>
      <ConversationModeNav
        active="chat"
        chatPath={`${location.pathname}${location.search}${location.hash}`}
        labels={{
          ariaLabel: 'Conversation mode',
          chat: 'Chat',
          work: 'Work',
        }}
      />
      <div data-testid="chat-workspace" />
    </main>
  );
}

jest.mock('~/hooks', () => ({
  useAuthContext: () => ({ token: 'test-token' }),
  useLocalize: () => (key: string) => mockLocalizedText[key] ?? key.replace(/^com_cyvox_/, ''),
}));
jest.mock('~/hooks/Nav/useDrawerViewport', () => ({
  __esModule: true,
  default: () => true,
}));
jest.mock('~/components/Chat/Menus/OpenSidebar', () => ({
  __esModule: true,
  default: () => <button type="button" aria-label="Open sidebar" />,
}));

function renderWorkRoute(initialPath = '/c/chat-42?source=work') {
  const router = createMemoryRouter(
    [
      { path: '/work', element: <CyVoxAddon /> },
      { path: '/cyvox/:tool', element: <CyVoxAddon /> },
      { path: '/c/:conversationId', element: <ChatModeRoute /> },
    ],
    { initialEntries: [initialPath] },
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, queryClient };
}

describe('Coderax Work route', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      json: async () => (String(input).endsWith('/models') ? { models: [] } : { tasks: [] }),
    })) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('switches between the same Chat route and Work route, with a shared mobile shell and readable controls', async () => {
    const { router, queryClient } = renderWorkRoute();

    expect(screen.getByTestId('chat-workspace')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Work' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/work'));

    expect(
      screen.getByRole('heading', { name: 'What would you like to work on?' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('textbox', { name: 'Describe what you want to get done' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start task' })).toBeDisabled();
    expect(screen.queryByText(/fast routing|cyvox/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open sidebar' })).toBeInTheDocument();
    const navigation = screen.getByRole('navigation', { name: 'Conversation mode' });
    expect(navigation).toHaveClass('rounded-lg', 'bg-surface-secondary');
    expect(screen.getByRole('link', { name: 'Work' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByLabelText('Work style')).toHaveClass(
      'bg-surface-secondary',
      'text-text-primary',
    );
    expect(screen.getByLabelText('Model')).toHaveClass('bg-surface-secondary', 'text-text-primary');

    fireEvent.click(screen.getByRole('link', { name: 'Chat' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/c/chat-42'));
    expect(router.state.location.search).toBe('?source=work');
    expect(screen.getByTestId('chat-workspace')).toBeInTheDocument();

    queryClient.clear();
  });

  it('opens a recent task in a conversation-style progress view', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      json: async () => {
        const url = String(input);
        if (url.endsWith('/models')) return { models: [] };
        if (url.endsWith('/tasks')) {
          return { tasks: [{ id: 'task-1', task: 'Prepare a launch plan', state: 'running' }] };
        }
        return { approvals: [] };
      },
    })) as unknown as typeof fetch;

    const { queryClient } = renderWorkRoute('/work');
    fireEvent.click(await screen.findByRole('button', { name: 'Prepare a launch plan running' }));

    expect(screen.getByRole('heading', { name: 'Prepare a launch plan' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Task status' })).toBeInTheDocument();
    expect(
      screen.getByRole('textbox', { name: 'Describe what you want to get done' }),
    ).toBeInTheDocument();

    queryClient.clear();
  });

  it('redirects the legacy Work URL and preserves the Chat return path', async () => {
    const router = createMemoryRouter(
      [
        { path: '/work', element: <CyVoxAddon /> },
        { path: '/cyvox/:tool', element: <CyVoxAddon /> },
        { path: '/c/:conversationId', element: <ChatModeRoute /> },
      ],
      {
        initialEntries: [
          {
            pathname: '/cyvox/work',
            search: '?source=legacy',
            state: { chatPath: '/c/chat-42?source=work' },
          },
        ],
      },
    );
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(router.state.location.pathname).toBe('/work'));
    expect(router.state.location.search).toBe('?source=legacy');
    expect(router.state.location.state).toEqual({ chatPath: '/c/chat-42?source=work' });
  });
  it('ignores IME composition Enter without submitting a task', async () => {
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
    const { queryClient } = renderWorkRoute('/work');
    const input = await screen.findByRole('textbox', {
      name: 'Describe what you want to get done',
    });
    fireEvent.change(input, { target: { value: 'Draft with IME' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true });
    expect(confirm).not.toHaveBeenCalled();
    expect(
      (global.fetch as unknown as jest.Mock).mock.calls.filter(
        ([, init]) => init?.method === 'POST',
      ),
    ).toHaveLength(0);
    expect(input).toHaveValue('Draft with IME');
    queryClient.clear();
  });

  it('uses the creation response ID rather than a concurrent task-list addition', async () => {
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    let taskListReads = 0;
    /** The first task-list read runs before creation, so it must not contain the new task. */
    const responseFor = (url: string) => {
      if (url.endsWith('/models')) {
        return { models: [] };
      }
      if (url.endsWith('/actions/startTask')) {
        return { id: 'our-task' };
      }
      if (!url.endsWith('/tasks')) {
        return { approvals: [] };
      }
      taskListReads += 1;
      return {
        tasks:
          taskListReads === 1
            ? []
            : [
                { id: 'other-task', task: 'Unrelated task', state: 'running' },
                { id: 'our-task', task: 'My task', state: 'running' },
              ],
      };
    };
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const data = responseFor(String(input));
      return { ok: true, json: async () => data };
    }) as unknown as typeof fetch;
    const { queryClient } = renderWorkRoute('/work');
    const input = await screen.findByRole('textbox', {
      name: 'Describe what you want to get done',
    });
    await waitFor(() => expect(taskListReads).toBeGreaterThan(0));
    fireEvent.change(input, { target: { value: 'My task' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start task' }));
    expect(await screen.findByRole('heading', { name: 'My task' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Unrelated task' })).not.toBeInTheDocument();
    queryClient.clear();
  });

  it('preserves newer composer edits when a pending task start completes', async () => {
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    let finishStart: (() => void) | undefined;
    const pendingStart = new Promise<{ ok: boolean; json: () => Promise<{ id: string }> }>(
      (resolve) => {
        finishStart = () => resolve({ ok: true, json: async () => ({ id: 'original' }) });
      },
    );
    let taskListReads = 0;
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/actions/startTask')) return pendingStart;
      if (url.endsWith('/models')) return { ok: true, json: async () => ({ models: [] }) };
      if (url.endsWith('/tasks')) {
        const tasks =
          ++taskListReads === 1
            ? []
            : [{ id: 'original', task: 'Original task', state: 'running' }];
        return { ok: true, json: async () => ({ tasks }) };
      }
      return { ok: true, json: async () => ({ approvals: [] }) };
    }) as unknown as typeof fetch;
    const { queryClient } = renderWorkRoute('/work');
    const input = await screen.findByRole('textbox', {
      name: 'Describe what you want to get done',
    });
    await waitFor(() => expect(taskListReads).toBeGreaterThan(0));
    fireEvent.change(input, { target: { value: 'Original task' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start task' }));
    fireEvent.change(input, { target: { value: 'New draft' } });
    finishStart?.();
    expect(await screen.findByRole('heading', { name: 'Original task' })).toBeInTheDocument();
    expect(input).toHaveValue('New draft');
    queryClient.clear();
  });

  it.each([204, 200])('accepts empty successful action response (%i)', async (status) => {
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/actions/startTask')) {
        return {
          ok: true,
          status,
          json: async () => {
            throw new SyntaxError('Unexpected end of JSON input');
          },
        };
      }
      return {
        ok: true,
        json: async () => (url.endsWith('/models') ? { models: [] } : { tasks: [] }),
      };
    }) as unknown as typeof fetch;

    const { queryClient } = renderWorkRoute('/work');
    const input = await screen.findByRole('textbox', {
      name: 'Describe what you want to get done',
    });
    fireEvent.change(input, { target: { value: 'Task without JSON metadata' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start task' }));

    await waitFor(() => expect(input).toHaveValue(''));
    expect(
      (global.fetch as unknown as jest.Mock).mock.calls.filter(
        ([, init]) => init?.method === 'POST',
      ),
    ).toHaveLength(1);
    expect(
      screen.queryByRole('heading', { name: 'Task without JSON metadata' }),
    ).not.toBeInTheDocument();
    queryClient.clear();
  });

  function mockWorkWithModel() {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/models')) {
        return {
          ok: true,
          json: async () => ({ models: [{ name: 'ollama:llama3:latest', compatible_now: true }] }),
        };
      }
      if (url.endsWith('/tasks')) return { ok: true, json: async () => ({ tasks: [] }) };
      return { ok: true, json: async () => ({ id: 'task-1' }) };
    }) as unknown as typeof fetch;
  }

  const startTaskCalls = () =>
    (global.fetch as unknown as jest.Mock).mock.calls.filter(
      ([input, init]) =>
        init?.method === 'POST' && String(input).endsWith('/api/cyvox/actions/startTask'),
    );

  it('submits the selected model and thinking effort with the task', async () => {
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    mockWorkWithModel();
    const { queryClient } = renderWorkRoute('/work');

    await screen.findByRole('option', { name: 'ollama:llama3:latest' });
    fireEvent.change(screen.getByLabelText('Model'), {
      target: { value: 'ollama:llama3:latest' },
    });
    fireEvent.change(screen.getByLabelText('Thinking effort'), { target: { value: 'high' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Describe what you want to get done' }), {
      target: { value: 'Prepare a launch plan' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start task' }));

    await waitFor(() => expect(startTaskCalls()).toHaveLength(1));
    expect(JSON.parse(String((startTaskCalls()[0][1] as RequestInit).body))).toEqual({
      task: 'Prepare a launch plan',
      mode: 'Autonomous Run',
      model: 'ollama:llama3:latest',
      thinking_effort: 'high',
    });
    queryClient.clear();
  });

  it('omits model and effort for the default selection', async () => {
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    mockWorkWithModel();
    const { queryClient } = renderWorkRoute('/work');

    await screen.findByRole('option', { name: 'ollama:llama3:latest' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Describe what you want to get done' }), {
      target: { value: 'Prepare a launch plan' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start task' }));

    await waitFor(() => expect(startTaskCalls()).toHaveLength(1));
    expect(JSON.parse(String((startTaskCalls()[0][1] as RequestInit).body))).toEqual({
      task: 'Prepare a launch plan',
      mode: 'Autonomous Run',
    });
    queryClient.clear();
  });

  it('says delegated team agents do not inherit the selection', async () => {
    mockWorkWithModel();
    const { queryClient } = renderWorkRoute('/work');

    await screen.findByRole('option', { name: 'ollama:llama3:latest' });
    expect(screen.queryByText(/delegated agents/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Work style'), {
      target: { value: 'Coding Team' },
    });

    expect(screen.getByText(/delegated agents/i)).toBeInTheDocument();
    queryClient.clear();
  });

  it('still sends the lead-task selection in team mode', async () => {
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    mockWorkWithModel();
    const { queryClient } = renderWorkRoute('/work');

    await screen.findByRole('option', { name: 'ollama:llama3:latest' });
    fireEvent.change(screen.getByLabelText('Work style'), {
      target: { value: 'Coding Team' },
    });
    fireEvent.change(screen.getByLabelText('Model'), {
      target: { value: 'ollama:llama3:latest' },
    });
    fireEvent.change(screen.getByLabelText('Thinking effort'), {
      target: { value: 'extra_high' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Describe what you want to get done' }), {
      target: { value: 'Ship the release' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start task' }));

    await waitFor(() => expect(startTaskCalls()).toHaveLength(1));
    expect(JSON.parse(String((startTaskCalls()[0][1] as RequestInit).body))).toEqual({
      task: 'Ship the release',
      mode: 'Coding Team',
      model: 'ollama:llama3:latest',
      thinking_effort: 'extra_high',
    });
    queryClient.clear();
  });

  it('never calls the deployment-global model action from Work', async () => {
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    mockWorkWithModel();
    const { queryClient } = renderWorkRoute('/work');

    await screen.findByRole('option', { name: 'ollama:llama3:latest' });
    fireEvent.change(screen.getByLabelText('Model'), {
      target: { value: 'ollama:llama3:latest' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Describe what you want to get done' }), {
      target: { value: 'Prepare a launch plan' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start task' }));

    await waitFor(() => expect(startTaskCalls()).toHaveLength(1));
    expect(
      (global.fetch as unknown as jest.Mock).mock.calls.map(([input]) => String(input)),
    ).not.toEqual(expect.arrayContaining([expect.stringContaining('selectModel')]));
    expect(screen.queryByRole('button', { name: 'Apply model' })).not.toBeInTheDocument();
    queryClient.clear();
  });
});
