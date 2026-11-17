/* eslint-disable i18next/no-literal-string */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import StartupLayout from '../Startup';

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: null, isFetching: false, error: null }),
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
}));
jest.mock('~/components/Auth/AuthLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));

function renderLogin(isGuestSession: boolean) {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <StartupLayout isAuthenticated isGuestSession={isGuestSession} />,
        children: [
          { path: 'login', element: <div data-testid="manual-login">Sign in</div> },
          { path: 'work/new', element: <div data-testid="work-page">Work</div> },
        ],
      },
    ],
    { initialEntries: ['/login?manual=1&redirect_to=%2Fwork%2Fnew'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

it('keeps manual owner sign-in open for an authenticated guest', async () => {
  const router = renderLogin(true);

  await waitFor(() => expect(screen.getByTestId('manual-login')).toBeInTheDocument());
  expect(router.state.location.pathname).toBe('/login');
});

it('redirects an already-authenticated owner away from the manual login page', async () => {
  const router = renderLogin(false);

  await waitFor(() => expect(router.state.location.pathname).toBe('/work/new'));
  expect(screen.getByTestId('work-page')).toBeInTheDocument();
});
