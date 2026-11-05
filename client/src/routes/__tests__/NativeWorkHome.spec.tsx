import React from 'react';
import { RecoilRoot } from 'recoil';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { dataService, EModelEndpoint, PermissionBits, QueryKeys } from 'coderax-data-provider';
import type { Agent, TWorkModelsResponse, TWorkTasksResponse } from 'coderax-data-provider';
import { getWorkModelKey } from '~/components/Chat/Input/WorkAgentSelector';
import NativeWorkHome from '../NativeWorkHome';

const messages: Record<string, string> = {
  com_ui_conversation_mode: 'Conversation mode',
  com_ui_chat: 'Chat',
  com_ui_work: 'Work',
  com_work_welcome_title: 'What would you like to work on?',
  com_work_history_loading: 'Loading recent work…',
  com_work_recent_heading: 'Recent tasks',
  com_work_description_label: 'Describe what you want to get done',
  com_work_description_placeholder: 'Tell me what you need to get done...',
  com_work_agent: 'Work agent',
  com_work_select_agent: 'Select an available agent',
  com_ui_model: 'Model',
  com_ui_cancel: 'Cancel',
  com_work_start_task_aria: 'Start task',
  com_work_tasks_unavailable: 'Unable to load recent work right now.',
  com_work_models_unavailable: 'Work models are unavailable.',
  com_work_agents_unavailable: 'Work agents are unavailable.',
  com_work_no_agents: 'No agent available for Work.',
  com_work_no_models: 'No free or local agent models are configured for Work yet.',
  com_work_cancel_task_confirmation: 'Cancel this Work task?',
  com_work_cancel_failed: 'Work could not cancel this task.',
  com_work_task_selection_note: 'Select an available agent for this task.',
  com_work_policy_note: 'Native tools retain their permission and approval controls.',
  com_ui_use_micrphone: 'Use microphone',
  com_ui_stop: 'Stop',
  com_ui_transcribing: 'Transcribing...',
};

const mockStartRecording = jest.fn();
const mockStopRecording = jest.fn();
const mockAbortRecording = jest.fn();
let mockSpeechOnText: ((text: string) => void) | undefined;
let mockSpeechIsListening = false;
let mockSpeechIsLoading = false;

jest.mock('~/hooks/Input/useSpeechToText', () => ({
  __esModule: true,
  default: (setText: (text: string) => void) => {
    mockSpeechOnText = setText;
    return {
      isListening: mockSpeechIsListening,
      isLoading: mockSpeechIsLoading,
      startRecording: mockStartRecording,
      stopRecording: mockStopRecording,
      abortRecording: mockAbortRecording,
    };
  },
}));

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
  const { container } = render(
    <RecoilRoot>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/work']}>
          <NativeWorkHome />
          <LocationDisplay />
        </MemoryRouter>
      </QueryClientProvider>
    </RecoilRoot>,
  );
  return { container, getModels, getTasks, queryClient };
}

describe('native Work home', () => {
  beforeEach(() => {
    mockStartRecording.mockClear();
    mockStopRecording.mockClear();
    mockAbortRecording.mockClear();
    mockSpeechOnText = undefined;
    mockSpeechIsListening = false;
    mockSpeechIsLoading = false;
  });

  afterEach(() => jest.restoreAllMocks());

  it('uses the shared mode switch and Work surface on its landing page', async () => {
    const { container, queryClient } = renderHome({ models: [] }, { tasks: [] }, []);

    const modeNav = screen.getByRole('navigation', { name: 'Conversation mode' });
    expect(within(modeNav).getByRole('link', { name: 'Chat' })).toHaveAttribute('href', '/c/new');
    expect(within(modeNav).getByRole('link', { name: 'Work' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(container.firstChild).toHaveClass('bg-surface-canvas');
    queryClient.clear();
  });

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
    const modelSelect = screen.getByLabelText('Model');
    expect(screen.queryByRole('option', { name: 'Paid agent' })).not.toBeInTheDocument();
    fireEvent.change(modelSelect, {
      target: { value: getWorkModelKey({ id: 'qwen2.5:latest', provider: 'ollama' }) },
    });
    await waitFor(() => expect(agentSelect).toHaveValue('agent-review'));
    fireEvent.change(agentSelect, { target: { value: 'agent-plan' } });
    await waitFor(() =>
      expect(modelSelect).toHaveValue(getWorkModelKey({ id: 'llama3:latest', provider: 'ollama' })),
    );
    fireEvent.change(agentSelect, { target: { value: 'agent-review' } });
    await waitFor(() =>
      expect(modelSelect).toHaveValue(
        getWorkModelKey({ id: 'qwen2.5:latest', provider: 'ollama' }),
      ),
    );
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

  it('distinguishes identical model ids from different providers', async () => {
    const { queryClient } = renderHome(
      {
        models: [
          { id: 'same-model', label: 'Ollama model', provider: 'ollama' },
          { id: 'same-model', label: 'llama.cpp model', provider: 'llama.cpp' },
        ],
      },
      { tasks: [] },
      [
        makeAgent('ollama-agent', 'Ollama agent', 'ollama', 'same-model'),
        makeAgent('llama-cpp-agent', 'llama.cpp agent', 'llama.cpp', 'same-model'),
      ],
    );

    const modelSelect = await screen.findByLabelText('Model');
    const agentSelect = screen.getByLabelText('Work agent');
    fireEvent.change(modelSelect, {
      target: { value: getWorkModelKey({ id: 'same-model', provider: 'llama.cpp' }) },
    });
    await waitFor(() => expect(agentSelect).toHaveValue('llama-cpp-agent'));
    expect(modelSelect).toHaveValue(getWorkModelKey({ id: 'same-model', provider: 'llama.cpp' }));
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

  it('disables task start after a model refresh failure with valid cached models', async () => {
    const { getModels, queryClient } = renderHome(
      { models: [{ id: 'local', label: 'Local', provider: 'ollama' }] },
      { tasks: [] },
      [makeAgent('agent-1', 'Planner', 'ollama', 'local')],
    );

    await screen.findByRole('option', { name: 'Planner' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Describe what you want to get done' }), {
      target: { value: 'Plan the release' },
    });
    expect(screen.getByRole('button', { name: 'Start task' })).toBeEnabled();

    getModels.mockRejectedValueOnce(new Error('catalog offline'));
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: [QueryKeys.workModels] });
    });

    expect(await screen.findByText('Work models are unavailable.')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Planner' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Describe what you want to get done' })).toHaveValue(
      'Plan the release',
    );
    expect(screen.getByRole('button', { name: 'Start task' })).toBeDisabled();
    expect(getModels).toHaveBeenCalledTimes(2);
    queryClient.clear();
  });

  it('keeps native task start available when only task history fails', async () => {
    const { queryClient } = renderHome(
      { models: [{ id: 'local', label: 'Local', provider: 'ollama' }] },
      { tasks: [] },
      [makeAgent('agent-1', 'Planner', 'ollama', 'local')],
      { getTasks: () => Promise.reject(new Error('history offline')) },
    );

    expect(await screen.findByText('Unable to load recent work right now.')).toBeInTheDocument();
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

    expect(await screen.findByText('Work could not cancel this task.')).toBeInTheDocument();
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

  it('dictates the task description through the microphone control', async () => {
    const { queryClient } = renderHome(
      { models: [{ id: 'local', label: 'Local', provider: 'ollama' }] },
      { tasks: [] },
      [makeAgent('agent-1', 'Planner', 'ollama', 'local')],
    );

    await screen.findByRole('option', { name: 'Planner' });
    fireEvent.click(screen.getByRole('button', { name: 'Use microphone' }));
    expect(mockStartRecording).toHaveBeenCalledTimes(1);

    act(() => mockSpeechOnText?.('Plan the launch'));
    expect(screen.getByRole('textbox', { name: 'Describe what you want to get done' })).toHaveValue(
      'Plan the launch',
    );
    queryClient.clear();
  });

  it('stops recording from the same microphone control', async () => {
    mockSpeechIsListening = true;
    const { queryClient } = renderHome(
      { models: [{ id: 'local', label: 'Local', provider: 'ollama' }] },
      { tasks: [] },
      [makeAgent('agent-1', 'Planner', 'ollama', 'local')],
    );

    await screen.findByRole('option', { name: 'Planner' });
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(mockStopRecording).toHaveBeenCalledTimes(1);
    queryClient.clear();
  });

  it('loads models, agents, and history from native Work data services', async () => {
    const originalFetch = global.fetch;
    const fetchSpy = Object.assign(jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(), {
      preconnect: jest.fn(),
    });
    global.fetch = fetchSpy;
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
        Reflect.deleteProperty(global, 'fetch');
      }
    }
  });
});
