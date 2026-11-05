import { dataService } from 'coderax-data-provider';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorkAgentConversationSelector } from '../WorkAgentSelector';
import { ConversationModeContext } from '../../mode';

const mockSetConversation = jest.fn();
jest.mock('coderax-data-provider', () => ({
  ...jest.requireActual('coderax-data-provider'),
  dataService: { getWorkModels: jest.fn(), getWorkAgents: jest.fn() },
}));
jest.mock('~/Providers', () => ({
  useChatContext: () => ({
    conversation: { conversationId: 'same-conversation', endpoint: 'openAI', model: 'paid' },
    isSubmitting: false,
    setConversation: mockSetConversation,
  }),
}));
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) =>
    ({ com_ui_model: 'Model', com_work_agent: 'Work agent' })[key] ?? key,
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

it('does not silently hide catalog failures or offer models from a previous Chat selection', async () => {
  jest.mocked(dataService.getWorkModels).mockRejectedValue(new Error('catalog unavailable'));
  const clientError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  setup();
  expect(await screen.findByRole('alert')).toHaveTextContent('com_work_models_unavailable');
  expect(screen.getByRole('combobox', { name: 'Model' })).toBeDisabled();
  expect(mockSetConversation).not.toHaveBeenCalled();
  clientError.mockRestore();
});
