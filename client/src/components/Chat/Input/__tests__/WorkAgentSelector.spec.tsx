import userEvent from '@testing-library/user-event';
import { dataService } from 'coderax-data-provider';
import { render, screen, waitFor } from '@testing-library/react';
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
  useLocalize: () => (key: string, values?: Record<string, string>) =>
    ({
      com_ui_model: 'Model',
      com_work_agent: 'Work agent',
      com_work_automatic_model: 'Auto',
      com_work_automatic_model_description: 'Chooses the best model for each task.',
      com_work_automatic_agent: 'Automatic agent',
      com_work_mode_build: 'Build',
      com_work_mode_build_description: 'Implement the request end to end.',
      com_work_mode_plan: 'Plan',
      com_work_mode_plan_description: 'Investigate and propose a plan before changing anything.',
      com_work_mode_mission: 'Mission',
      com_work_mode_mission_description: 'Carry a larger goal through verified milestones.',
      com_work_mode_skills: 'Skills',
      com_work_mode_skills_description: 'Apply your saved skills while working.',
      com_work_provider_status: 'Provider status',
      com_work_provider_requests_left: `${values?.[0]} of ${values?.[1]} requests left`,
      com_work_provider_available: 'Available',
      com_work_provider_no_paid: 'No paid fallback',
      com_work_provider_primary: 'Preferred model',
      com_work_provider_unverified: 'No verified free endpoint',
      com_work_provider_quota_exhausted: 'Quota exhausted',
      com_work_provider_cooling_down: 'Cooling down',
      com_work_provider_unavailable: 'Unavailable',
      com_work_provider_unconfigured: 'No server credential',
      com_work_provider_not_enabled: 'Free routing is off.',
      com_work_routing_exhausted: 'Free capacity is exhausted; no paid model is used.',
    })[key] ?? key,
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
          mode: 'code',
          setMode: jest.fn(),
          adoptConversation: jest.fn(),
        }}
      >
        <WorkAgentConversationSelector />
      </ConversationModeContext.Provider>
    </QueryClientProvider>,
  );
}

async function openSelect(name: 'Model' | 'Work agent') {
  const user = userEvent.setup();
  const button = await screen.findByRole('button', { name });
  await waitFor(() => expect(button).not.toBeDisabled());
  await user.click(button);
  return { button, user };
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
      {
        id: 'nvidia/nemotron-3-ultra-550b-a55b:free',
        label: 'NVIDIA Nemotron 3 Ultra (free)',
        provider: 'FreeOpenRouter',
      },
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

it('keeps Auto in the model menu and selects the automatic route', async () => {
  setup();
  const { user } = await openSelect('Model');
  const auto = await screen.findByRole('menuitemradio', { name: /^Auto/ });

  await user.click(auto);

  expect(screen.getByRole('button', { name: 'Model' })).toHaveTextContent('Auto');
});

it('offers Build, Plan, Mission, and Skills and switches modes without losing the model', async () => {
  setup();
  const { user } = await openSelect('Work agent');

  for (const name of ['Build', 'Plan', 'Mission', 'Skills']) {
    expect(
      await screen.findByRole('menuitemradio', { name: new RegExp(`^${name}`) }),
    ).toBeInTheDocument();
  }
  expect(screen.getByRole('menuitemradio', { name: /^Build/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  await user.click(screen.getByRole('menuitemradio', { name: /^Plan/ }));

  expect(screen.getByRole('button', { name: 'Work agent' })).toHaveTextContent('Plan');
  expect(screen.getByRole('button', { name: 'Model' })).not.toBeDisabled();
});

it('selects an eligible agent and pins its model without resetting Chat settings or identity', async () => {
  setup();
  const { user } = await openSelect('Work agent');
  await user.click(await screen.findByRole('menuitemradio', { name: 'Reviewer' }));

  const modelButton = screen.getByRole('button', { name: 'Model' });
  await waitFor(() => expect(modelButton).toHaveTextContent('Free model'));
  expect(modelButton).toBeDisabled();
  expect(mockSetConversation).not.toHaveBeenCalled();
  expect(screen.queryByRole('menuitemradio', { name: 'paid' })).not.toBeInTheDocument();
});

it('offers the owner-only OpenCode engine as a selectable Work model', async () => {
  setup();
  const { user } = await openSelect('Model');
  await user.click(await screen.findByRole('menuitemradio', { name: 'OpenCode' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Model' })).toHaveTextContent('OpenCode'),
  );
});

it('offers the Freebuff engine the server reports as available', async () => {
  jest.mocked(dataService.getWorkModels).mockResolvedValue({
    models: [
      { id: 'free', label: 'Free model', provider: 'Ollama' },
      { id: 'freebuff', label: 'Freebuff', provider: 'freebuff', engine: 'freebuff' },
    ],
  });
  setup();

  const { user } = await openSelect('Model');
  await user.click(await screen.findByRole('menuitemradio', { name: 'Freebuff' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Model' })).toHaveTextContent('Freebuff'),
  );
});

it('does not offer the OpenCode engine to non-owners', async () => {
  mockRole = 'USER';
  setup();
  const { user } = await openSelect('Model');
  expect(await screen.findByRole('menuitemradio', { name: 'Free model' })).toBeInTheDocument();
  expect(screen.queryByRole('menuitemradio', { name: 'OpenCode' })).not.toBeInTheDocument();
  await user.keyboard('{Escape}');
});

it('selects the sole OpenCode engine when there is no automatic target', async () => {
  jest.mocked(dataService.getWorkModels).mockResolvedValue({ models: [] });
  jest.mocked(dataService.getWorkAgents).mockResolvedValue({ agents: [] });
  setup();

  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Model' })).toHaveTextContent('OpenCode'),
  );
});

it('does not offer an engine model without a provider', async () => {
  mockRole = 'USER';
  jest.mocked(dataService.getWorkModels).mockResolvedValue({
    models: [{ id: 'engine', label: 'Engine', engine: 'opencode' }],
  });
  setup();

  expect(await screen.findByRole('alert')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Model' })).toBeDisabled());
});

it('shows full model labels in the themed menu', async () => {
  setup();
  await openSelect('Model');

  const option = await screen.findByRole('menuitemradio', {
    name: 'NVIDIA Nemotron 3 Ultra (free)',
  });
  expect(option).toHaveTextContent('NVIDIA Nemotron 3 Ultra (free)');
  expect(option.closest('[role="menu"]')).toHaveClass('bg-surface-menu');
});

it('shows server-reported provider availability in the model menu', async () => {
  jest.mocked(dataService.getWorkRouting).mockResolvedValue({
    routing: {
      enabled: true,
      primary: {
        available: false,
        label: 'DeepSeek-R1 671B',
        modelIds: [],
        reason: 'no_verified_free_endpoint',
        checkedAt: '2026-11-08',
        evidence: [],
      },
      activeModel: null,
      endpoints: [
        {
          id: 'openrouter-nemotron-ultra-free',
          provider: 'openrouter',
          modelId: 'nvidia/nemotron-3-ultra-550b-a55b:free',
          label: 'NVIDIA Nemotron 3 Ultra (free)',
          kind: 'fallback',
          freeEligible: true,
          credentialPresent: true,
          healthy: true,
          available: true,
          rejectionReason: null,
          cooldownUntil: null,
          tools: true,
          quota: {
            requestsUsed: 10,
            requestsLimit: 200,
            tokensUsed: 1_000,
            tokensLimit: 400_000,
            resetAt: 0,
            requestsPerMinuteUsed: 0,
            requestsPerMinuteLimit: 20,
            requestsPerMinuteResetAt: 60_000,
          },
        },
      ],
      paidRoutesEnabled: false,
    },
  });
  setup();
  await openSelect('Model');

  const status = await screen.findByTestId('work-provider-status');
  expect(status).toHaveTextContent('Provider status');
  expect(status).toHaveTextContent('NVIDIA Nemotron 3 Ultra (free)');
  expect(status).toHaveTextContent('nvidia/nemotron-3-ultra-550b-a55b:free');
  expect(status).toHaveTextContent('Available');
  expect(status).toHaveTextContent('190 of 200 requests left');
  expect(status).toHaveTextContent('No verified free endpoint');
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
  expect(screen.getByRole('button', { name: 'Model' })).toBeDisabled();
  expect(mockSetConversation).not.toHaveBeenCalled();
  clientError.mockRestore();
});
