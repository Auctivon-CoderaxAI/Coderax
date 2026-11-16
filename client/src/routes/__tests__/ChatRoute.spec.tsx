import React from 'react';
import { getDefaultStore } from 'jotai';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { TConversation } from 'coderax-data-provider';
import type { PrimitiveAtom } from 'jotai';
import type { WorkSelection } from '~/components/Chat/Input/workSelection';
import { workSelectionFamily } from '~/components/Chat/Input/WorkAgentSelector';
import ChatRoute from '../ChatRoute';

const mockWorkSelectionAtoms = new Map<string, PrimitiveAtom<WorkSelection | null>>();
const mockSetConversation = jest.fn();
const mockFetchConversation = jest.fn();
const mockUseGetMessagesByConvoId = jest.fn();
const mockHasSetConversation = { current: true };
let mockConversation: Partial<TConversation> = { conversationId: 'chat-a' };
const mockConfig = {};
const mockRoles = { USER: {} };
let mockAuthenticatedUser: { id: string; provider: string } | undefined;
let mockAssistantListMap = {};
let mockDefaultModelSpec: unknown = {};
const mockNewConversation = jest.fn(({ template }: { template?: Partial<TConversation> }) => {
  mockConversation = { conversationId: 'new', ...template };
  mockSetConversation();
});

jest.mock('recoil', () => ({
  useRecoilValue: () => false,
  useRecoilCallback: () => () => {},
}));
jest.mock('~/store', () => ({
  __esModule: true,
  default: {
    useCreateConversationAtom: () => ({
      conversation: mockConversation,
      hasSetConversation: mockHasSetConversation,
    }),
  },
}));
jest.mock('~/store/temporary', () => ({ __esModule: true, default: {} }));
jest.mock('~/components/Chat/Input/WorkAgentSelector', () => {
  const { atom } = jest.requireActual('jotai');
  return {
    useWorkOptions: () => ({
      options: { models: [], agents: [], auto: null },
      modelsQuery: { isError: false },
      agentsQuery: { isError: false },
      isLoading: false,
    }),
    workSelectionFamily: (key: string) => {
      let selection = mockWorkSelectionAtoms.get(key);
      if (!selection) {
        selection = atom(null) as PrimitiveAtom<WorkSelection | null>;
        mockWorkSelectionAtoms.set(key, selection);
      }
      return selection;
    },
  };
});
jest.mock('../useAuthRedirect', () => ({
  __esModule: true,
  default: () => ({ isAuthenticated: true, roles: mockRoles, user: mockAuthenticatedUser }),
}));
jest.mock('coderax-data-provider/react-query', () => ({
  useGetModelsQuery: () => ({ data: mockConfig }),
}));
jest.mock('~/data-provider', () => ({
  useGetMessagesByConvoId: (...args: unknown[]) => mockUseGetMessagesByConvoId(...args),
  useGetStartupConfig: () => ({ data: mockConfig }),
  useGetEndpointsQuery: () => ({ data: mockConfig }),
  useTokenConfigQuery: () => ({ data: {} }),
  useListAgentsQuery: () => ({}),
  useProjectQuery: () => ({}),
  useGetConvoIdQuery: (id: string, options: { enabled: boolean }) => {
    const { useQuery: query } = jest.requireActual('@tanstack/react-query');
    return query(['conversation', id], () => mockFetchConversation(id), {
      ...options,
      retry: false,
      staleTime: Infinity,
    });
  },
}));
jest.mock('~/hooks', () => ({
  useAssistantListMap: () => mockAssistantListMap,
  useIdChangeEffect: () => {},
  useAppStartup: () => {},
  useNewConvo: () => ({ newConversation: mockNewConversation }),
  useLocalize: () => (key: string) => key,
}));
jest.mock('~/Providers', () => ({
  ToolCallsMapProvider: ({ children }: { children: React.ReactNode }) => children,
  useAgentsMapContext: () => mockConfig,
}));
jest.mock('@coderax/client', () => ({
  Spinner: () => <span />,
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  useToastContext: () => ({ showToast: jest.fn() }),
}));
jest.mock('~/utils', () => ({
  defaultSpecAwaitsAgents: () => false,
  processValidSettings: () => ({}),
  getDefaultModelSpec: () => mockDefaultModelSpec,
  hasModelSelection: () => false,
  isNotFoundError: () => false,
  isTemporaryConversation: () => false,
  clearMessagesCache: jest.fn(),
  logger: { log: jest.fn() },
}));
jest.mock('~/components/Chat/ChatView', () => ({
  __esModule: true,
  default: ({ workMode }: { workMode: boolean }) => {
    const ModeNav = jest.requireActual('~/components/Chat/ConversationModeNav').default;
    return (
      <div data-testid="composer">
        {mockConversation.conversationId}
        <ModeNav
          active={workMode ? 'work' : 'chat'}
          labels={{ ariaLabel: 'Conversation mode', chat: 'Chat', work: 'Work' }}
        />
        <textarea aria-label="Draft" />
        <input aria-label="Attachment" type="file" />
      </div>
    );
  },
}));

function Harness({ workMode = false }: { workMode?: boolean }) {
  const [, update] = React.useReducer((n: number) => n + 1, 0);
  mockSetConversation.mockImplementation(update);
  return <ChatRoute workMode={workMode} />;
}

function setup(initialEntries = ['/c/chat-a'], initialIndex = initialEntries.length - 1) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      { path: '/c/:conversationId', element: <Harness /> },
      { path: '/work/:conversationId', element: <Harness workMode /> },
      { path: '/login', element: <div data-testid="login-page">Owner sign-in</div> },
    ],
    { initialEntries, initialIndex },
  );
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { client, router };
}

beforeEach(() => {
  localStorage.clear();
  for (const atom of mockWorkSelectionAtoms.values()) {
    getDefaultStore().set(atom, null);
  }
  mockWorkSelectionAtoms.clear();
  mockConversation = { conversationId: 'chat-a' };
  mockHasSetConversation.current = true;
  mockAssistantListMap = {};
  mockDefaultModelSpec = {};
  mockAuthenticatedUser = undefined;
  mockFetchConversation.mockImplementation(async (id: string) => ({ conversationId: id }));
  mockUseGetMessagesByConvoId.mockReset().mockReturnValue({});
});

it.each(['/c/chat-a?projectId=keep#anchor', '/work/chat-a?prompt=keep#anchor'])(
  'switches execution modes in place at %s without replacing the composer or its input state',
  async (path) => {
    const { router } = setup([path]);
    const composer = screen.getByTestId('composer');
    const draft = screen.getByRole('textbox', { name: 'Draft' });
    const attachment = screen.getByLabelText('Attachment') as HTMLInputElement;
    const file = new File(['requirements'], 'requirements.txt', { type: 'text/plain' });
    fireEvent.change(draft, { target: { value: 'Keep my draft' } });
    fireEvent.change(attachment, { target: { files: [file] } });
    const location = { ...router.state.location };

    fireEvent.click(screen.getByRole('button', { name: 'Work' }));
    expect(screen.getByRole('button', { name: 'Work' })).toHaveAttribute('aria-pressed', 'true');
    expect(router.state.location).toEqual(location);
    expect(screen.getByTestId('composer')).toBe(composer);
    expect(draft).toHaveValue('Keep my draft');
    expect(attachment.files?.[0]).toBe(file);
    expect(mockConversation.conversationId).toBe('chat-a');

    fireEvent.click(screen.getByRole('button', { name: 'Chat' }));
    expect(screen.getByRole('button', { name: 'Chat' })).toHaveAttribute('aria-pressed', 'true');
    expect(router.state.location).toEqual(location);
    expect(screen.getByTestId('composer')).toBe(composer);
    expect(draft).toHaveValue('Keep my draft');
    expect(attachment.files?.[0]).toBe(file);
    expect(mockNewConversation).not.toHaveBeenCalled();
  },
);

it('does not redirect a stored Work transcript away from its existing Chat deep link', async () => {
  mockConversation = { conversationId: 'previous-chat' };
  mockFetchConversation.mockResolvedValue({ conversationId: 'chat-a', isWork: true });
  const { router } = setup(['/c/chat-a']);
  await waitFor(() => expect(screen.getByTestId('composer')).toHaveTextContent('chat-a'));
  expect(router.state.location.pathname).toBe('/c/chat-a');
  expect(screen.getByRole('button', { name: 'Work' })).toHaveAttribute('aria-pressed', 'true');
});

it('copies a new Work selection to the acknowledged conversation without replacing a saved one', async () => {
  const store = getDefaultStore();
  const newSelectionKey = JSON.stringify(['', 'new']);
  const targetSelectionKey = JSON.stringify(['', 'work-id']);
  const selection = { agentId: 'agent-local', modelKey: 'local-model' };
  const existingSelection = { agentId: 'agent-saved', modelKey: 'saved-model' };
  store.set(workSelectionFamily(newSelectionKey), selection);

  const { router } = setup(['/work/new']);
  await act(() => router.navigate('/work/work-id'));

  await waitFor(() => {
    expect(store.get(workSelectionFamily(targetSelectionKey))).toEqual(selection);
  });

  store.set(workSelectionFamily(targetSelectionKey), existingSelection);
  await act(() => router.navigate('/work/new'));
  await act(() => router.navigate('/work/work-id'));

  await waitFor(() => {
    expect(store.get(workSelectionFamily(targetSelectionKey))).toEqual(existingSelection);
  });
});


it('redirects a guest Work task to owner sign-in and preserves the draft without auto-submitting', async () => {
  mockAuthenticatedUser = { id: 'guest-1', provider: 'guest' };
  const { router } = setup(['/work/new?prompt=Fix+the+Work+start+flow&submit=true']);

  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/login');
    const loginParams = new URLSearchParams(router.state.location.search);
    expect(loginParams.get('manual')).toBe('1');
    const redirectTo = loginParams.get('redirect_to');
    expect(redirectTo).toBeTruthy();
    const target = new URL(redirectTo!, 'https://coderaxai.vercel.app');
    expect(target.pathname).toBe('/work/new');
    expect(target.searchParams.get('prompt')).toBe('Fix the Work start flow');
    expect(target.searchParams.has('submit')).toBe(false);
  });

  expect(screen.getByTestId('login-page')).toBeInTheDocument();
  expect(mockNewConversation).not.toHaveBeenCalled();
});

it('requires owner sign-in when a guest switches from Chat to Work in place', async () => {
  mockAuthenticatedUser = { id: 'guest-1', provider: 'guest' };
  const { router } = setup(['/c/chat-a']);

  fireEvent.click(screen.getByRole('button', { name: 'Work' }));

  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/login');
    const loginParams = new URLSearchParams(router.state.location.search);
    expect(loginParams.get('manual')).toBe('1');
    expect(loginParams.get('redirect_to')).toBe('/c/chat-a');
  });
});

it('starts the authenticated transcript query while route metadata is still pending', async () => {
  mockConversation = { conversationId: 'previous-chat' };
  mockFetchConversation.mockReturnValue(new Promise(() => {}));

  setup(['/c/chat-a']);

  await waitFor(() =>
    expect(mockUseGetMessagesByConvoId).toHaveBeenCalledWith(
      'chat-a',
      expect.objectContaining({ enabled: true, notifyOnChangeProps: [] }),
    ),
  );
  expect(screen.getByTestId('composer')).not.toBeVisible();
});

it('reconciles Back and Forward with each route, including new chat', async () => {
  const { router } = setup(['/c/new', '/c/chat-b', '/c/chat-a']);
  await act(async () => {
    await router.navigate(-1);
  });
  await waitFor(() => expect(screen.getByTestId('composer')).toHaveTextContent('chat-b'));
  await act(async () => {
    await router.navigate(-1);
  });
  await waitFor(() => expect(screen.getByTestId('composer')).toHaveTextContent('new'));
  await act(async () => {
    await router.navigate(1);
  });
  await waitFor(() => expect(screen.getByTestId('composer')).toHaveTextContent('chat-b'));
});

it('does not reset a new conversation when its server id arrives before the URL', async () => {
  mockConversation = { conversationId: 'new' };
  const { router } = setup(['/c/new']);
  act(() => {
    mockConversation = { conversationId: 'created-chat' };
    mockSetConversation();
  });
  expect(mockNewConversation).not.toHaveBeenCalled();
  await act(async () => {
    await router.navigate('/c/created-chat', { replace: true });
  });
  expect(mockNewConversation).not.toHaveBeenCalled();
  expect(mockFetchConversation).not.toHaveBeenCalled();
});

it('reuses the full cached record when returning through history', async () => {
  const { client, router } = setup(['/c/chat-b', '/c/chat-a']);
  client.setQueryData(['conversation', 'chat-b'], {
    conversationId: 'chat-b',
    model: 'saved-model',
  });
  await act(async () => {
    await router.navigate(-1);
  });
  await waitFor(() =>
    expect(mockConversation).toMatchObject({ conversationId: 'chat-b', model: 'saved-model' }),
  );
  expect(mockFetchConversation).not.toHaveBeenCalled();
});

it('keeps the departing composer mounted but hidden until the destination record arrives', async () => {
  let resolveRecord: (value: Partial<TConversation>) => void = () => {};
  mockFetchConversation.mockReturnValue(
    new Promise<Partial<TConversation>>((resolve) => {
      resolveRecord = resolve;
    }),
  );
  const { router } = setup(['/c/chat-b', '/c/chat-a']);
  const composer = screen.getByTestId('composer');
  await act(async () => {
    await router.navigate(-1);
  });
  expect(screen.getByTestId('composer')).toBe(composer);
  expect(composer).not.toBeVisible();
  await act(async () => {
    resolveRecord({ conversationId: 'chat-b' });
  });
  await waitFor(() => expect(composer).toBeVisible());
  expect(composer).toHaveTextContent('chat-b');
});

it('ignores a response for a route left while its record was loading', async () => {
  let resolveRecord: (value: Partial<TConversation>) => void = () => {};
  mockFetchConversation.mockReturnValue(
    new Promise<Partial<TConversation>>((resolve) => {
      resolveRecord = resolve;
    }),
  );
  const { router } = setup(['/c/chat-b', '/c/chat-a']);
  await act(async () => {
    await router.navigate(-1);
  });
  await act(async () => {
    await router.navigate(1);
  });
  await act(async () => {
    resolveRecord({ conversationId: 'chat-b' });
  });
  expect(screen.getByTestId('composer')).toHaveTextContent('chat-a');
  expect(mockNewConversation).not.toHaveBeenCalled();
});

it('allows retry after a failed history load without replacing the departing draft', async () => {
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  mockFetchConversation.mockRejectedValueOnce(new Error('offline'));
  const { router } = setup(['/c/chat-b', '/c/chat-a']);
  await act(async () => {
    await router.navigate(-1);
  });
  await screen.findByRole('alert');
  expect(mockConversation.conversationId).toBe('chat-a');
  expect(screen.getByTestId('composer')).not.toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'com_ui_retry' }));
  await waitFor(() => expect(screen.getByTestId('composer')).toBeVisible());
  expect(mockConversation.conversationId).toBe('chat-b');
  expect(consoleError).toHaveBeenCalledWith(new Error('offline'));
});

it('waits for the conversation record even when assistant catalogs are already loaded', async () => {
  mockAssistantListMap = { assistants: {}, azureAssistants: {} };
  mockFetchConversation.mockReturnValue(new Promise(() => {}));
  const { router } = setup(['/c/chat-b', '/c/chat-a']);
  await act(async () => {
    await router.navigate(-1);
  });
  expect(mockNewConversation).not.toHaveBeenCalled();
  expect(mockConversation.conversationId).toBe('chat-a');
  expect(screen.getByTestId('composer')).not.toBeVisible();
});

it('reconciles a remounted chat route with conversation state retained by the shell', async () => {
  setup(['/c/chat-b']);
  await waitFor(() => expect(screen.getByTestId('composer')).toHaveTextContent('chat-b'));
  expect(mockFetchConversation).toHaveBeenCalledWith('chat-b');
});

it('does not apply the Chat default model spec to a new Work conversation', async () => {
  mockConversation = { conversationId: 'new' };
  mockHasSetConversation.current = false;
  mockDefaultModelSpec = {
    default: {
      name: 'chat-default',
      preset: { endpoint: 'Mock Provider A', model: 'mock-model-a' },
    },
  };

  setup(['/work/new?prompt=Do+the+task&submit=true']);

  await waitFor(() => expect(mockNewConversation).toHaveBeenCalled());
  expect(mockNewConversation).toHaveBeenCalledWith(
    expect.objectContaining({
      template: expect.objectContaining({ isWork: true }),
    }),
  );
  expect(mockNewConversation.mock.calls.at(-1)?.[0]).not.toHaveProperty('preset');
});
