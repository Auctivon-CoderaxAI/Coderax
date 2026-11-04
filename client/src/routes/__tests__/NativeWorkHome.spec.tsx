import React from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { dataService, EModelEndpoint, PermissionBits, QueryKeys } from 'coderax-data-provider';
import type { Agent, TWorkModelsResponse, TWorkTasksResponse } from 'coderax-data-provider';
import NativeWorkHome from '../NativeWorkHome';

const messages: Record<string, string> = {
  com_cyvox_work_welcome_title: 'What would you like to work on?',
  com_cyvox_work_welcome_description: 'Describe the outcome you want.',
  com_cyvox_work_history_loading: 'Loading recent work…',
  com_cyvox_work_recent_heading: 'Recent tasks',
  com_cyvox_work_description_label: 'Describe what you want to get done',
  com_cyvox_work_description_placeholder: 'Tell me what you need to get done...',
  com_work_agent: 'Work agent',
  com_work_select_agent: 'Select an available agent',
  com_cyvox_cancel: 'Cancel',
  com_cyvox_work_start_task_aria: 'Start task',
  com_cyvox_tasks_unavailable: 'Unable to load recent work right now.',
  com_work_models_unavailable: 'Work models are unavailable.',
  com_work_agents_unavailable: 'Work agents are unavailable.',
  com_work_no_agents: 'No agent available for Work.',
  com_work_no_models: 'No free or local agent models are configured for Work yet.',
  com_work_cancel_task_confirmation: 'Cancel this Work task?',
  com_work_cancel_failed: 'Work could not cancel this task.',
  com_work_task_selection_note: 'Select an available agent for this task.',
  com_cyvox_work_policy_note: 'Native tools retain their permission and approval controls.',
};

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => messages[key] ?? key,
  useAgentDefaultPermissionLevel: () => 1,
}));

jest.mock('coderax-data-provider', () => {
  const actual = jest.requireActual('coderax-data-provider');
  return {
    ...actual,
    dataService: {
      ...actual.dataService,
      getWorkModels: jest.fn(),
      getWorkTasks: jest.fn(),
      cancelWorkTask: jest.fn(),
    },
  };
});

function makeAgent(id: string, name: string, provider: string, model: string): Agent {
  return { id, name, provider, model } as unknown as Agent;
}

function LocationDisplay() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

type RenderOverrides = {
  getModels?: () => Promise<TWorkModelsResponse>;
  getTasks?: () => Promise<TWorkTasksResponse>;
};

function renderHome(
  models: TWorkModelsResponse,
  tasks: TWorkTasksResponse,
  agents: Agent[],
  overrides: RenderOverrides = {},
) {
  const getModels = jest
    .spyOn(dataService, 'getWorkModels')
    .mockImplementation(overrides.getModels ?? (() => Promise.resolve(models)));
  const getTasks = jest
    .spyOn(dataService, 'getWorkTasks')
    .mockImplementation(overrides.getTasks ?? (() => Promise.resolve(tasks)));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData([QueryKeys.endpoints], { [EModelEndpoint.agents]: {} });
  queryClient.setQueryData([QueryKeys.agents, { requiredPermission: PermissionBits.VIEW }], {
    object: 'list',
    data: agents,
    has_more: false,
    first_id: '',
    last_id: '',
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/work']}>
        <NativeWorkHome />
        <LocationDisplay />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { getModels, getTasks, queryClient };
}

describe('native Work home', () => {
  afterEach(() => jest.restoreAllMocks());

  it('starts a native Work task with the selected accessible agent', async () => {
    const { getModels, getTasks, queryClient } = renderHome(
      {
        models: [
          { id: 'llama3:latest', label: 'Llama 3', provider: 'ollama' },
          { id: 'qwen2.5:latest', label: 'Qwen', provider: 'ollama' },
        ],
      },
      { tasks: [] },
      [
        makeAgent('agent-plan', 'Planner', 'ollama', 'llama3:latest'),
        makeAgent('agent-review', 'Reviewer', 'ollama', 'qwen2.5:latest'),
        makeAgent('agent-paid', 'Paid agent', 'openai', 'gpt-4o'),
      ],
    );

    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
    await screen.findByRole('option', { name: 'Reviewer' });
    const agentSelect = screen.getByLabelText('Work agent');
    expect(screen.queryByRole('option', { name: 'Paid agent' })).not.toBeInTheDocument();
    fireEvent.change(agentSelect, { target: { value: 'agent-review' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Describe what you want to get done' }), {
      target: { value: '  Make a rollout plan  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start task' }));

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/work/new?prompt=Make+a+rollout+plan&submit=true&endpoint=agents&agent_id=agent-review&model=qwen2.5%3Alatest',
      ),
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(getModels).toHaveBeenCalledTimes(1);
    expect(getTasks).toHaveBeenCalledTimes(1);
    queryClient.clear();
  });

  it('keeps task start disabled when no accessible agent has a Work-eligible model', async () => {
    const { queryClient } = renderHome(
      { models: [{ id: 'llama3:latest', label: 'Llama 3', provider: 'ollama' }] },
      { tasks: [] },
      [
        makeAgent('wrong-provider', 'Wrong provider', 'openai', 'llama3:latest'),
        makeAgent('paid-model', 'Paid model', 'openai', 'gpt-4o'),
      ],
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('No agent available for Work.');
    expect(screen.getByRole('button', { name: 'Start task' })).toBeDisabled();
    queryClient.clear();
  });

  it('shows an empty-model state and keeps task start disabled', async () => {
    const { queryClient } = renderHome({ models: [] }, { tasks: [] }, []);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No free or local agent models are configured for Work yet.',
    );
    expect(screen.getByRole('button', { name: 'Start task' })).toBeDisabled();
    queryClient.clear();
  });

  it('cancels only the selected task through the owner-scoped native task service', async () => {
    const { queryClient } = renderHome(
      { models: [{ id: 'local', label: 'Local', provider: 'ollama' }] },
      { tasks: [{ id: 'task-1', title: 'Refresh the report', state: 'running' }] },
      [makeAgent('agent-1', 'Planner', 'ollama', 'local')],
    );
    const cancel = jest.spyOn(dataService, 'cancelWorkTask').mockResolvedValue({ canceled: true });
    jest.spyOn(window, 'confirm').mockReturnValue(true);

    await screen.findByRole('button', { name: 'Cancel Refresh the report' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Refresh the report' }));

    await waitFor(() => expect(cancel).toHaveBeenCalledWith('task-1'));
    queryClient.clear();
  });

  it('surfaces an actionable model error and keeps task start disabled', async () => {
    const { queryClient } = renderHome(
      { models: [] },
      { tasks: [] },
      [],
      { getModels: () => Promise.reject(new Error('catalog offline')) },
    );

    expect(
      await screen.findByText('Work models are unavailable.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start task' })).toBeDisabled();
    queryClient.clear();
  });

  it('keeps native task start available when only task history fails', async () => {
    const { queryClient } = renderHome(
      { models: [{ id: 'local', label: 'Local', provider: 'ollama' }] },
      { tasks: [] },
      [makeAgent('agent-1', 'Planner', 'ollama', 'local')],
      { getTasks: () => Promise.reject(new Error('history offline')) },
    );

    expect(
      await screen.findByText('Unable to load recent work right now.'),
    ).toBeInTheDocument();
    await screen.findByRole('option', { name: 'Planner' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Describe what you want to get done' }), {
      target: { value: 'Plan the release' },
    });
    expect(screen.getByRole('button', { name: 'Start task' })).toBeEnabled();
    queryClient.clear();
  });

  it('surfaces a failed cancel without dropping the task row', async () => {
    const { queryClient } = renderHome(
      { models: [{ id: 'local', label: 'Local', provider: 'ollama' }] },
      { tasks: [{ id: 'task-1', title: 'Refresh the report', state: 'running' }] },
      [makeAgent('agent-1', 'Planner', 'ollama', 'local')],
    );
    jest.spyOn(dataService, 'cancelWorkTask').mockRejectedValue(new Error('cancel failed'));
    jest.spyOn(window, 'confirm').mockReturnValue(true);

    await screen.findByRole('button', { name: 'Cancel Refresh the report' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Refresh the report' }));

    expect(
      await screen.findByText('Work could not cancel this task.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel Refresh the report' })).toBeInTheDocument();
    queryClient.clear();
  });

  it('does not offer cancel for an already-terminal task', async () => {
    const { queryClient } = renderHome(
      { models: [{ id: 'local', label: 'Local', provider: 'ollama' }] },
      { tasks: [{ id: 'task-2', title: 'Finished report', state: 'completed' }] },
      [makeAgent('agent-1', 'Planner', 'ollama', 'local')],
    );

    await screen.findByText('Finished report');
    expect(
      screen.queryByRole('button', { name: 'Cancel Finished report' }),
    ).not.toBeInTheDocument();
    queryClient.clear();
  });

  it('loads native models, agents, and history without calling the optional CyVox addon', async () => {
    const originalFetch = global.fetch;
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const { queryClient } = renderHome(
        { models: [{ id: 'local', label: 'Local', provider: 'ollama' }] },
        { tasks: [] },
        [makeAgent('agent-1', 'Planner', 'ollama', 'local')],
      );

      await screen.findByRole('option', { name: 'Planner' });
      expect(fetchSpy).not.toHaveBeenCalled();
      queryClient.clear();
    } finally {
      if (originalFetch) {
        global.fetch = originalFetch;
      } else {
        delete (global as typeof globalThis & { fetch?: typeof fetch }).fetch;
      }
    }
  });
});
