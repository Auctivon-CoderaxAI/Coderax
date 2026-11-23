/* eslint-disable i18next/no-literal-string */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useOutletContext } from 'react-router-dom';
import type { TLoginLayoutContext } from '~/common';
import StartupLayout from '../Startup';

const mockRefetch = jest.fn().mockResolvedValue(undefined);

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: null, isFetching: false, error: null, refetch: mockRefetch }),
}));
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));
jest.mock('~/utils', () => ({
  DEFAULT_APP_TITLE: 'Coderax',
  setDocumentTitle: jest.fn(),
  getPostLoginRedirect: jest.fn(() => '/work/new'),
  getPostLoginFallback: jest.fn(() => '/c/new'),
  isRequiredTwoFactorSetupRoute: jest.fn(() => false),
  isManualLoginEntry: jest.fn(() => false),
}));
jest.mock('~/components/Auth/AuthLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));

function renderStartup(initialEntry: string, children: React.ReactNode) {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <StartupLayout isAuthenticated />,
        children: [
          { path: 'login', element: children },
          { path: 'connect', element: children },
          { path: 'work/new', element: children },
        ],
      },
    ],
    { initialEntries: [initialEntry] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

it('redirects an authenticated arrival to the requested destination', async () => {
  const router = renderStartup(
    '/login?redirect_to=%2Fwork%2Fnew',
    <div data-testid="destination">Destination</div>,
  );

  await waitFor(() => expect(router.state.location.pathname).toBe('/work/new'));
  expect(screen.getByTestId('destination')).toBeInTheDocument();
});

function ConfigRetry() {
  const { refetchStartupConfig } = useOutletContext<TLoginLayoutContext>();
  return (
    <button type="button" onClick={() => void refetchStartupConfig()}>
      Retry
    </button>
  );
}

it('leaves the guest hand-off to the child route and lets it retry config', async () => {
  const router = renderStartup('/connect?redirect_to=%2Fwork%2Fnew', <ConfigRetry />);

  await waitFor(() => expect(router.state.location.pathname).toBe('/connect'));
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(mockRefetch).toHaveBeenCalledTimes(1);
});
