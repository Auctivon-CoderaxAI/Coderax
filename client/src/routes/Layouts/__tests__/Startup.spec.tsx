/* eslint-disable i18next/no-literal-string */
import React from 'react';
import axios from 'axios';
import { RecoilRoot } from 'recoil';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useOutletContext } from 'react-router-dom';
import type { TLoginLayoutContext } from '~/common';
import StartupLayout from '../Startup';

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: jest.requireActual('~/data-provider/Endpoints/queries').useGetStartupConfig,
}));
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));
jest.mock('~/utils', () => ({
  normalizeStartupConfigModelSpecs:
    jest.requireActual('~/utils/endpoints').normalizeStartupConfigModelSpecs,
  DEFAULT_APP_TITLE: 'Coderax',
  setDocumentTitle: jest.fn(),
  getPostLoginRedirect: jest.fn(() => '/work/new'),
  getPostLoginFallback: jest.fn(() => '/c/new'),
  isManualLoginEntry: jest.fn(() => false),
  isRequiredTwoFactorSetupRoute: jest.fn(() => false),
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
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, cacheTime: 0 } },
    logger: { ...console, error: jest.fn() },
  });
  render(
    <RecoilRoot>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </RecoilRoot>,
  );
  return router;
}

it('redirects an authenticated arrival to the requested destination', async () => {
  jest.spyOn(axios, 'get').mockResolvedValue({ data: { appTitle: 'Coderax' } });
  const router = renderStartup(
    '/login?redirect_to=%2Fwork%2Fnew',
    <div data-testid="destination">Destination</div>,
  );

  await waitFor(() => expect(router.state.location.pathname).toBe('/work/new'));
  expect(screen.getByTestId('destination')).toBeInTheDocument();
});

function ConfigRetry() {
  const { startupConfig, startupConfigError, refetchStartupConfig } =
    useOutletContext<TLoginLayoutContext>();
  if (startupConfig) {
    return <div>{startupConfig.appTitle}</div>;
  }
  return startupConfigError ? (
    <button type="button" onClick={() => void refetchStartupConfig()}>
      Retry
    </button>
  ) : null;
}

it('keeps the guest hand-off on /connect and passes recovered config to the outlet', async () => {
  const request = jest
    .spyOn(axios, 'get')
    .mockRejectedValueOnce(new Error('Configuration request failed'))
    .mockResolvedValueOnce({ data: { appTitle: 'Recovered configuration' } });
  const router = renderStartup('/connect?redirect_to=%2Fwork%2Fnew', <ConfigRetry />);

  const retry = await screen.findByRole('button', { name: 'Retry' });
  expect(router.state.location.pathname).toBe('/connect');
  fireEvent.click(retry);
  expect(await screen.findByText('Recovered configuration')).toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/connect');
  expect(request.mock.calls.map(([url]) => url)).toEqual(['/api/config', '/api/config']);
});
