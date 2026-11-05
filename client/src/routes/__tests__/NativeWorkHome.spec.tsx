import React from 'react';
import { RecoilRoot } from 'recoil';
import { Provider as JotaiProvider } from 'jotai';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { dataService, QueryKeys } from 'coderax-data-provider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type {
  TWorkAgent,
  TWorkAgentsResponse,
  TWorkModelsResponse,
  TWorkTasksResponse,
} from 'coderax-data-provider';
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
  com_work_automatic_agent: 'Automatic',
  com_ui_model: 'Model',
  com_ui_cancel: 'Cancel',
  com_work_start_task_aria: 'Start task',
  com_work_tasks_unavailable: 'Unable to load recent work right now.',
  com_work_models_unavailable: 'Work models are unavailable.',
  com_work_agents_unavailable: 'Work agents are unavailable.',
  com_work_no_models: 'No free or local agent models are configured for Work yet.',
  com_work_cancel_task_confirmation: 'Cancel this Work task?',
  com_work_cancel_failed: 'Work could not cancel this task.',
  com_work_model_set_by_agent: 'The selected agent runs on its own model.',
  com_work_policy_note: 'Native tools retain their permission and approval controls.',
  com_ui_use_micrphone: 'Use microphone',
  com_ui_stop: 'Stop',
  com_ui_transcribing: 'Transcribing...',
};

const format = (key: string, values?: Record<string, string | number>) => {
  if (key === 'com_work_automatic_model') {
    return `Automatic (${values?.['0']})`;
  }
  if (key === 'com_work_runs_on_model') {
    return `Runs on ${values?.['0']}.`;
  }
  if (key === 'com_work_runs_agent_on_model') {
    return `${values?.['0']} runs on ${values?.['1']}.`;
  }
  if (key === 'com_work_with_agents') {
    return `Hands work to ${values?.['0']}.`;
  }
  if (key === 'com_work_agent_coordinates') {
    return `${values?.['0']} · coordinates ${values?.['1']} agents`;
  }
  return messages[key] ?? key;
};

const mockStartRecording = jest.fn();
const mockStopRecording = jest.fn();
const mockAbortRecording = jest.fn();
let mockSpeechOnText: ((text: string) => void) | undefined;
let mockSpeechIsListening = false;

jest.mock('~/hooks/Input/useSpeechToText', () => ({
  __esModule: true,
  default: (setText: (text: string) => void) => {
    mockSpeechOnText = setText;
    return {
      isListening: mockSpeechIsListening,
      isLoading: false,
      startRecording: mockStartRecording,
      stopRecording: mockStopRecording,
      abortRecording: mockAbortRecording,
    };
  },
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => format,
}));

jest.mock('~/components/Chat/Footer', () => ({
  __esModule: true,
  default: () => <footer data-testid="chat-footer" />,
}));

jest.mock('coderax-data-provider', () => {
  const actual = jest.requireActual('coderax-data-provider');
  return {
    ...actual,
    dataService: {
      ...actual.dataService,
      getWorkModels: jest.fn(),
      getWorkAgents: jest.fn(),
      getWorkTasks: jest.fn(),
      cancelWorkTask: jest.fn(),
    },
  };
});

const LOCAL_A = { id: 'qwen3.5:4b', label: 'qwen3.5:4b', provider: 'ollama' };
const LOCAL_B = { id: 'qwen3.5:9b', label: 'qwen3.5:9b', provider: 'ollama' };
const AUTO = {
  id: 'auto',
  label: 'Automatic',
  auto: true as const,
  target: { id: LOCAL_A.id, label: LOCAL_A.label, provider: LOCAL_A.provider },
};
const CATALOG: TWorkModelsResponse = { models: [AUTO, LOCAL_A, LOCAL_B] };

function makeAgent(
  id: string,
  name: string,
  model = LOCAL_B.id,
  members: TWorkAgent['members'] = [],
): TWorkAgent {
  return { id, name, model, provider: 'ollama', members };
}

function LocationDisplay() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

type RenderOverrides = {
  centerFormOnLanding?: boolean;
  getModels?: () => Promise<TWorkModelsResponse>;
  getAgents?: () => Promise<TWorkAgentsResponse>;
  getTasks?: () => Promise<TWorkTasksResponse>;
};

function renderHome(
  models: TWorkModelsResponse,
  tasks: TWorkTasksResponse,
  agents: TWorkAgent[],
  overrides: RenderOverrides = {},
) {
  const getModels = jest
    .spyOn(dataService, 'getWorkModels')
    .mockImplementation(overrides.getModels ?? (() => Promise.resolve(models)));
  const getAgents = jest
    .spyOn(dataService, 'getWorkAgents')
    .mockImplementation(overrides.getAgents ?? (() => Promise.resolve({ agents })));
  const getTasks = jest
    .spyOn(dataService, 'getWorkTasks')
    .mockImplementation(overrides.getTasks ?? (() => Promise.resolve(tasks)));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (
    <JotaiProvider>
      <RecoilRoot>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/work']}>
            <NativeWorkHome centerFormOnLanding={overrides.centerFormOnLanding ?? true} />
            <LocationDisplay />
          </MemoryRouter>
        </QueryClientProvider>
      </RecoilRoot>
    </JotaiProvider>
  );
  const view = render(tree);
  return { ...view, getModels, getAgents, getTasks, queryClient };
}

const taskBox = () => screen.getByRole('textbox', { name: 'Describe what you want to get done' });
const startButton = () => screen.getByRole('button', { name: 'Start task' });
const modelSelect = () => screen.getByRole('combobox', { name: 'Model' });
const agentSelect = () => screen.getByRole('combobox', { name: 'Work agent' });

async function startWith(description: string) {
  fireEvent.change(taskBox(), { target: { value: description } });
  await waitFor(() => expect(startButton()).toBeEnabled());
  fireEvent.click(startButton());
  return new URLSearchParams(screen.getByTestId('location').textContent?.split('?')[1] ?? '');
}

describe('native Work home', () => {
  beforeEach(() => {
    localStorage.clear();
    mockStartRecording.mockClear();
    mockStopRecording.mockClear();
    mockAbortRecording.mockClear();
    mockSpeechOnText = undefined;
    mockSpeechIsListening = false;
  });

  afterEach(() => jest.restoreAllMocks());

  it('renders on the shared Chat landing geometry with Work active in the mode switch', async () => {
    const { queryClient } = renderHome(CATALOG, { tasks: [] }, []);

    const main = screen.getByRole('main');
    expect(main).toHaveClass('bg-surface-canvas');
    const modeNav = within(main).getByRole('navigation', { name: 'Conversation mode' });
    expect(within(modeNav).getByRole('link', { name: 'Chat' })).toHaveAttribute('href', '/c/new');
    expect(within(modeNav).getByRole('link', { name: 'Work' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByTestId('work-landing')).toHaveClass(
      'flex-1',
      'justify-end',
      'sm:justify-center',
    );
    expect(screen.getByTestId('work-composer-form')).toHaveClass('md:max-w-3xl', 'xl:max-w-4xl');
    expect(screen.getByTestId('work-composer-surface')).toHaveClass(
      'rounded-t-theme-surface-lg',
      'sm:rounded-theme-surface-lg',
    );
    expect(screen.getByTestId('chat-footer')).toBeInTheDocument();
    await screen.findByRole('option', { name: 'Automatic (qwen3.5:4b)' });
    queryClient.clear();
  });

  it('uses the host-provided landing preference for composer spacing', () => {
    const { queryClient } = renderHome(CATALOG, { tasks: [] }, [], {
      centerFormOnLanding: false,
    });
    expect(screen.getByTestId('work-composer-form')).toHaveClass('sm:mb-10');
    expect(screen.getByTestId('work-composer-form')).not.toHaveClass('sm:mb-28');
    queryClient.clear();
  });

  it('defaults to automatic routing and names the model it resolves to', async () => {
    const { queryClient } = renderHome(CATALOG, { tasks: [] }, [makeAgent('agent-1', 'Planner')]);

    await screen.findByRole('option', { name: 'Automatic (qwen3.5:4b)' });
    expect(modelSelect()).toHaveValue('auto');
    expect(agentSelect()).toHaveValue('auto');
    expect(screen.getByTestId('work-selection-summary')).toHaveTextContent('Runs on qwen3.5:4b.');

    const search = await startWith('Plan the release');
    expect(screen.getByTestId('location')).toHaveTextContent('/work/new?');
    expect(search.get('endpoint')).toBe('ollama');
    expect(search.get('model')).toBe('qwen3.5:4b');
    expect(search.get('agent_id')).toBeNull();
    expect(search.get('submit')).toBe('true');
    queryClient.clear();
  });

  it('starts on an explicitly chosen model without an agent', async () => {
    const { queryClient } = renderHome(CATALOG, { tasks: [] }, []);

    await screen.findByRole('option', { name: 'qwen3.5:9b' });
    fireEvent.change(modelSelect(), { target: { value: getWorkModelKey(LOCAL_B) } });
    expect(screen.getByTestId('work-selection-summary')).toHaveTextContent('Runs on qwen3.5:9b.');

    const search = await startWith('Summarize the notes');
    expect(search.get('endpoint')).toBe('ollama');
    expect(search.get('model')).toBe('qwen3.5:9b');
    expect(search.get('agent_id')).toBeNull();
    queryClient.clear();
  });

  it('starts an explicitly chosen agent on its own model and names the agents it coordinates', async () => {
    const lead = makeAgent('agent-lead', 'Lead', LOCAL_B.id, [
      { id: 'agent-writer', name: 'Writer', model: LOCAL_A.id, provider: 'ollama' },
    ]);
    const { queryClient } = renderHome(CATALOG, { tasks: [] }, [lead]);

    await screen.findByRole('option', { name: 'Lead · coordinates 1 agents' });
    fireEvent.change(agentSelect(), { target: { value: 'agent-lead' } });

    expect(modelSelect()).toBeDisabled();
    expect(modelSelect()).toHaveValue(getWorkModelKey(LOCAL_B));
    expect(within(modelSelect()).getAllByRole('option')).toHaveLength(1);
    expect(screen.getByTestId('work-selection-summary')).toHaveTextContent(
      'Lead runs on qwen3.5:9b. Hands work to Writer.',
    );

    const search = await startWith('Draft the launch post');
    expect(search.get('endpoint')).toBe('agents');
    expect(search.get('agent_id')).toBe('agent-lead');
    expect(search.get('model')).toBe('qwen3.5:9b');
    queryClient.clear();
  });

  it('never offers a model or agent outside the server catalog', async () => {
    const stray = makeAgent('agent-paid', 'Paid helper', 'gpt-4o');
    const { queryClient } = renderHome(CATALOG, { tasks: [] }, [makeAgent('a1', 'Planner'), stray]);

    await screen.findByRole('option', { name: 'Planner' });
    expect(screen.queryByRole('option', { name: 'Paid helper' })).not.toBeInTheDocument();
    expect(
      within(modelSelect())
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Automatic (qwen3.5:4b)', 'qwen3.5:4b', 'qwen3.5:9b']);
    queryClient.clear();
  });

  it('remembers the selection across a refresh', async () => {
    const first = renderHome(CATALOG, { tasks: [] }, [makeAgent('agent-1', 'Planner')]);
    await screen.findByRole('option', { name: 'Planner' });
    fireEvent.change(agentSelect(), { target: { value: 'agent-1' } });
    first.queryClient.clear();
    first.unmount();
    jest.restoreAllMocks();

    const second = renderHome(CATALOG, { tasks: [] }, [makeAgent('agent-1', 'Planner')]);
    await screen.findByRole('option', { name: 'Planner' });
    await waitFor(() => expect(agentSelect()).toHaveValue('agent-1'));
    second.queryClient.clear();
  });

  it('falls back to automatic when a remembered agent is no longer offered', async () => {
    localStorage.setItem(
      'workSelection',
      JSON.stringify({ agentId: 'agent-gone', modelKey: getWorkModelKey(LOCAL_B) }),
    );
    const { queryClient } = renderHome(CATALOG, { tasks: [] }, [makeAgent('agent-1', 'Planner')]);

    await screen.findByRole('option', { name: 'Planner' });
    expect(agentSelect()).toHaveValue('auto');
    const search = await startWith('Plan it');
    expect(search.get('agent_id')).toBeNull();
    queryClient.clear();
  });

  it('keeps automatic routing and models usable when the agent list fails', async () => {
    const { queryClient } = renderHome(CATALOG, { tasks: [] }, [], {
      getAgents: () => Promise.reject(new Error('agents offline')),
    });

    expect(await screen.findByText('Work agents are unavailable.')).toBeInTheDocument();
    expect(agentSelect()).toBeDisabled();
    const search = await startWith('Plan the release');
    expect(search.get('model')).toBe('qwen3.5:4b');
    queryClient.clear();
  });

  it('shows an empty-model state and keeps task start disabled', async () => {
    const { queryClient } = renderHome({ models: [] }, { tasks: [] }, []);

    expect(
      await screen.findByText('No free or local agent models are configured for Work yet.'),
    ).toBeInTheDocument();
    fireEvent.change(taskBox(), { target: { value: 'Plan the release' } });
    expect(startButton()).toBeDisabled();
    expect(screen.queryByTestId('work-selection-summary')).not.toBeInTheDocument();
    queryClient.clear();
  });

  it('disables task start after a model refresh failure with valid cached models', async () => {
    const { getModels, queryClient } = renderHome(CATALOG, { tasks: [] }, []);

    await screen.findByRole('option', { name: 'Automatic (qwen3.5:4b)' });
    fireEvent.change(taskBox(), { target: { value: 'Plan the release' } });
    expect(startButton()).toBeEnabled();

    getModels.mockRejectedValueOnce(new Error('catalog offline'));
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: [QueryKeys.workModels] });
    });

    expect(await screen.findByText('Work models are unavailable.')).toBeInTheDocument();
    expect(taskBox()).toHaveValue('Plan the release');
    expect(startButton()).toBeDisabled();
    queryClient.clear();
  });

  it('keeps native task start available when only task history fails', async () => {
    const { queryClient } = renderHome(CATALOG, { tasks: [] }, [], {
      getTasks: () => Promise.reject(new Error('history offline')),
    });

    expect(await screen.findByText('Unable to load recent work right now.')).toBeInTheDocument();
    fireEvent.change(taskBox(), { target: { value: 'Plan the release' } });
    await waitFor(() => expect(startButton()).toBeEnabled());
    queryClient.clear();
  });

  it('shows the agent and model each recent task ran on', async () => {
    const { queryClient } = renderHome(
      CATALOG,
      {
        tasks: [
          {
            id: 'task-1',
            title: 'Refresh the report',
            state: 'completed',
            model: 'qwen3.5:9b',
            agentId: 'agent-1',
          },
        ],
      },
      [makeAgent('agent-1', 'Planner')],
    );

    const row = await screen.findByRole('button', { name: /Refresh the report/ });
    await waitFor(() => expect(row).toHaveTextContent('Planner · qwen3.5:9b'));
    queryClient.clear();
  });

  it('cancels only the selected task through the owner-scoped native task service', async () => {
    const { queryClient } = renderHome(
      CATALOG,
      { tasks: [{ id: 'task-1', title: 'Refresh the report', state: 'running' }] },
      [],
    );
    const cancel = jest.spyOn(dataService, 'cancelWorkTask').mockResolvedValue({ canceled: true });
    jest.spyOn(window, 'confirm').mockReturnValue(true);

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel Refresh the report' }));

    await waitFor(() => expect(cancel).toHaveBeenCalledWith('task-1'));
    queryClient.clear();
  });

  it('surfaces a failed cancel without dropping the task row', async () => {
    const { queryClient } = renderHome(
      CATALOG,
      { tasks: [{ id: 'task-1', title: 'Refresh the report', state: 'running' }] },
      [],
    );
    jest.spyOn(dataService, 'cancelWorkTask').mockRejectedValue(new Error('cancel failed'));
    jest.spyOn(window, 'confirm').mockReturnValue(true);

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel Refresh the report' }));

    expect(await screen.findByText('Work could not cancel this task.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel Refresh the report' })).toBeInTheDocument();
    queryClient.clear();
  });

  it('does not offer cancel for an already-terminal task', async () => {
    const { queryClient } = renderHome(
      CATALOG,
      { tasks: [{ id: 'task-2', title: 'Finished report', state: 'completed' }] },
      [],
    );

    await screen.findByText('Finished report');
    expect(
      screen.queryByRole('button', { name: 'Cancel Finished report' }),
    ).not.toBeInTheDocument();
    queryClient.clear();
  });

  it('dictates the task description through the microphone control', async () => {
    const { queryClient } = renderHome(CATALOG, { tasks: [] }, []);

    fireEvent.click(await screen.findByRole('button', { name: 'Use microphone' }));
    expect(mockStartRecording).toHaveBeenCalledTimes(1);

    act(() => mockSpeechOnText?.('Plan the launch'));
    expect(taskBox()).toHaveValue('Plan the launch');
    queryClient.clear();
  });

  it('stops recording from the same microphone control', async () => {
    mockSpeechIsListening = true;
    const { queryClient } = renderHome(CATALOG, { tasks: [] }, []);

    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    expect(mockStopRecording).toHaveBeenCalledTimes(1);
    queryClient.clear();
  });

  it('loads native models, agents and history without external fetches', async () => {
    const originalFetch = global.fetch;
    const fetchSpy = Object.assign(jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(), {
      preconnect: jest.fn(),
    });
    global.fetch = fetchSpy;
    try {
      const { getAgents, getModels, getTasks, queryClient } = renderHome(CATALOG, { tasks: [] }, [
        makeAgent('agent-1', 'Planner'),
      ]);

      await screen.findByRole('option', { name: 'Planner' });
      expect(getModels).toHaveBeenCalled();
      expect(getAgents).toHaveBeenCalled();
      expect(getTasks).toHaveBeenCalled();
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
