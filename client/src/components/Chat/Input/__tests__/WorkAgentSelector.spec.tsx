import { dataService } from 'coderax-data-provider';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorkAgentConversationSelector } from '../WorkAgentSelector';
import { ConversationModeContext } from '../../mode';

const mockSetConversation = jest.fn();
jest.mock('coderax-data-provider', () => ({
  ...jest.requireActual('coderax-data-provider'),
  dataService: {
    getWorkModels: jest.fn(),
    getWorkAgents: jest.fn(),
    getWorkReadiness: jest.fn(),
    getWorkRouting: jest.fn(),
  },
}));
jest.mock('~/Providers', () => ({
  useChatContext: () => ({
    conversation: { conversationId: 'same-conversation', endpoint: 'openAI', model: 'paid' },
    isSubmitting: false,
    setConversation: mockSetConversation,
  }),
}));
let mockRole = 'ADMIN';
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) =>
    ({ com_ui_model: 'Model', com_work_agent: 'Work agent' })[key] ?? key,
  useAuthContext: () => ({ user: { role: mockRole } }),
}));

let scope = 0;
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ConversationModeContext.Provider
        value={{
          selectionKey: `selection-test-${scope++}`,
          mode: 'work',
          setMode: jest.fn(),
          adoptConversation: jest.fn(),
        }}
      >
        <WorkAgentConversationSelector />
      </ConversationModeContext.Provider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  mockRole = 'ADMIN';
  mockSetConversation.mockClear();
  jest.mocked(dataService.getWorkModels).mockResolvedValue({
    models: [
      {
        id: 'auto',
        label: 'Automatic',
        auto: true,
        target: { id: 'free', label: 'Free model', provider: 'Ollama' },
      },
      { id: 'free', label: 'Free model', provider: 'Ollama' },
    ],
  });
  jest.mocked(dataService.getWorkAgents).mockResolvedValue({
    agents: [{ id: 'reviewer', name: 'Reviewer', model: 'free', provider: 'Ollama', members: [] }],
  });
  jest.mocked(dataService.getWorkReadiness).mockResolvedValue({
    readiness: { ready: true, checks: [], nextAction: null, nextActionDescriptor: null },
  });
  jest.mocked(dataService.getWorkRouting).mockResolvedValue({
    routing: {
      enabled: false,
      primary: {
        available: false,
        label: 'DeepSeek-R1 671B',
        modelIds: [],
        reason: 'no_verified_free_endpoint',
        checkedAt: '2026-11-08',
        evidence: [],
      },
      activeModel: null,
      endpoints: [],
      paidRoutesEnabled: false,
    },
  });
});

afterEach(() => jest.restoreAllMocks());

it('selects an eligible agent and pins its model without resetting Chat settings or identity', async () => {
  setup();
  await screen.findByRole('option', { name: 'Reviewer' });
  fireEvent.change(screen.getByRole('combobox', { name: 'Work agent' }), {
    target: { value: 'reviewer' },
  });
  expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue('["Ollama","free"]');
  expect(screen.getByRole('combobox', { name: 'Model' })).toBeDisabled();
  expect(mockSetConversation).not.toHaveBeenCalled();
  expect(screen.queryByRole('option', { name: 'paid' })).not.toBeInTheDocument();
});

it('offers the owner-only OpenCode engine as a selectable Work model', async () => {
  setup();
  expect(await screen.findByRole('option', { name: 'OpenCode' })).toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox', { name: 'Model' }), {
    target: { value: '["opencode","opencode"]' },
  });
  expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue(
    '["opencode","opencode"]',
  );
});

it('does not offer the OpenCode engine to non-owners', async () => {
  mockRole = 'USER';
  setup();
  await screen.findByRole('option', { name: 'Free model' });
  expect(screen.queryByRole('option', { name: 'OpenCode' })).not.toBeInTheDocument();
});

it('selects the sole OpenCode engine when there is no automatic target', async () => {
  jest.mocked(dataService.getWorkModels).mockResolvedValue({ models: [] });
  jest.mocked(dataService.getWorkAgents).mockResolvedValue({ agents: [] });
  setup();

  expect(await screen.findByRole('option', { name: 'OpenCode' })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue(
    '["opencode","opencode"]',
  );
});

it('does not offer an engine model without a provider', async () => {
  mockRole = 'USER';
  jest.mocked(dataService.getWorkModels).mockResolvedValue({
    models: [{ id: 'engine', label: 'Engine', engine: 'opencode' }],
  });
  setup();

  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'Engine' })).not.toBeInTheDocument();
});

it('localizes a readiness action instead of rendering the server English string', async () => {
  jest.mocked(dataService.getWorkModels).mockResolvedValue({ models: [] });
  jest.mocked(dataService.getWorkAgents).mockResolvedValue({ agents: [] });
  jest.mocked(dataService.getWorkReadiness).mockResolvedValue({
    readiness: {
      ready: false,
      checks: [],
      nextAction: 'Set OPENROUTER_API_KEY on the server and restart.',
      nextActionDescriptor: {
        id: 'set_provider_credential',
        envName: 'OPENROUTER_API_KEY',
      },
    },
  });
  setup();

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('com_work_readiness_set_provider_credential');
  expect(alert).not.toHaveTextContent('Set OPENROUTER_API_KEY on the server and restart.');
});

it('does not silently hide catalog failures or offer models from a previous Chat selection', async () => {
  jest.mocked(dataService.getWorkModels).mockRejectedValue(new Error('catalog unavailable'));
  const clientError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  setup();
  expect(await screen.findByRole('alert')).toHaveTextContent('com_work_models_unavailable');
  expect(screen.getByRole('combobox', { name: 'Model' })).toBeDisabled();
  expect(mockSetConversation).not.toHaveBeenCalled();
  clientError.mockRestore();
});
