import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CyVoxAddon from '../CyVoxAddon';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));
jest.mock('~/hooks/Nav/useDrawerViewport', () => ({
  __esModule: true,
  default: () => false,
}));

describe('CyVox Work compatibility route', () => {
  it('redirects the legacy URL to native Work and preserves location state', async () => {
    const router = createMemoryRouter(
      [
        { path: '/work', element: <main>{'Native Work'}</main> },
        { path: '/cyvox/:tool', element: <CyVoxAddon /> },
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
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(router.state.location.pathname).toBe('/work'));
    expect(router.state.location.search).toBe('?source=legacy');
    expect(router.state.location.state).toEqual({ chatPath: '/c/chat-42?source=work' });
    expect(screen.getByText('Native Work')).toBeInTheDocument();
    queryClient.clear();
  });
});
