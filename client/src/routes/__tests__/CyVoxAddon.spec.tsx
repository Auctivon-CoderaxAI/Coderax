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
  com_cyvox_execution: 'Execution',
  com_cyvox_model: 'Model',
  com_cyvox_task_progress: 'Task progress',
  com_cyvox_work_heading: 'Coderax Work · Fast routing',
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

function renderWorkRoute() {
  const router = createMemoryRouter(
    [
      { path: '/work', element: <CyVoxAddon /> },
      { path: '/cyvox/:tool', element: <CyVoxAddon /> },
      { path: '/c/:conversationId', element: <ChatModeRoute /> },
    ],
    { initialEntries: ['/c/chat-42?source=work'] },
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
  });

  it('switches between the same Chat route and Work route, with a shared mobile shell and readable controls', async () => {
    const { router, queryClient } = renderWorkRoute();

    expect(screen.getByTestId('chat-workspace')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Work' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/work'));

    expect(screen.getByText('Coderax')).toBeInTheDocument();
    expect(screen.queryByText(/CyVox/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open sidebar' })).toBeInTheDocument();
    const navigation = screen.getByRole('navigation', { name: 'Conversation mode' });
    expect(navigation).toHaveClass('rounded-lg', 'bg-surface-secondary');
    expect(screen.getByRole('link', { name: 'Work' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByLabelText('Execution')).toHaveClass(
      'bg-surface-primary',
      'text-text-primary',
    );
    expect(screen.getByLabelText('Model')).toHaveClass('bg-surface-primary', 'text-text-primary');

    fireEvent.click(screen.getByRole('link', { name: 'Chat' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/c/chat-42'));
    expect(router.state.location.search).toBe('?source=work');
    expect(screen.getByTestId('chat-workspace')).toBeInTheDocument();

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
});
