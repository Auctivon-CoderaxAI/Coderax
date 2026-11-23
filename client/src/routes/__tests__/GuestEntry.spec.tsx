/* eslint-disable i18next/no-literal-string */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom';
import { useAuthContext } from '~/hooks/AuthContext';
import { SESSION_KEY } from '~/utils/redirect';
import GuestEntry from '../GuestEntry';

jest.mock('~/hooks/AuthContext', () => ({
  useAuthContext: jest.fn(),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

const auth = (overrides: Record<string, unknown> = {}) => ({
  isAuthReady: true,
  isAuthenticated: false,
  user: undefined,
  passwordLogin: jest.fn(),
  passwordLoginError: undefined,
  ...overrides,
});

function renderEntry(passwordLoginEnabled = false, initialEntry = '/connect') {
  const router = createMemoryRouter(
    [
      {
        element: (
          <Outlet
            context={{
              startupConfig: {
                passwordLoginEnabled,
                githubLoginEnabled: true,
                socialLoginEnabled: true,
                socialLogins: ['github'],
                serverDomain: 'https://example.test',
              },
              isFetching: false,
            }}
          />
        ),
        children: [
          { path: '/connect', element: <GuestEntry /> },
          { path: '/c/new', element: <div>Chat workspace</div> },
          { path: '/work/new', element: <div>Work workspace</div> },
        ],
      },
    ],
    { initialEntries: [initialEntry] },
  );
  const { unmount } = render(<RouterProvider router={router} />);
  return { router, unmount };
}

describe('guest and password entry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.sessionStorage.removeItem(SESSION_KEY);
  });

  it('never renders the old login form while a guest session is being requested', () => {
    (useAuthContext as jest.Mock).mockReturnValue(auth({ isAuthReady: false }));
    renderEntry();
    expect(screen.getByRole('status')).toHaveTextContent('Opening Coderax');
    expect(screen.queryByText('Welcome back')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('shows an honest server-unavailable state rather than a password form when the gate is off', () => {
    (useAuthContext as jest.Mock).mockReturnValue(auth());
    renderEntry();
    expect(screen.getByRole('alert')).toHaveTextContent('Coderax is unavailable');
    expect(screen.getByRole('button', { name: 'Retry connection' })).toBeInTheDocument();
    expect(screen.queryByText('Welcome back')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  });

  it('opens chat only after the backend issues an authenticated session', async () => {
    (useAuthContext as jest.Mock).mockReturnValue(
      auth({ isAuthenticated: true, user: { provider: 'local' } }),
    );
    const { router } = renderEntry();
    await screen.findByText('Chat workspace');
    expect(router.state.location.pathname).toBe('/c/new');
  });

  it('honors redirect_to when an authenticated user arrives', async () => {
    (useAuthContext as jest.Mock).mockReturnValue(
      auth({ isAuthenticated: true, user: { provider: 'local' } }),
    );
    const { router } = renderEntry(false, '/connect?redirect_to=%2Fwork%2Fnew');
    await screen.findByText('Work workspace');
    expect(router.state.location.pathname).toBe('/work/new');
  });

  it('restores and consumes the requested workspace after a social sign-in round trip', async () => {
    (useAuthContext as jest.Mock).mockReturnValue(auth());
    const { unmount } = renderEntry(false, '/connect?redirect_to=%2Fwork%2Fnew');
    expect(screen.getByRole('link', { name: 'com_auth_github_login' })).toHaveAttribute(
      'href',
      'https://example.test/oauth/github',
    );
    expect(window.sessionStorage.getItem(SESSION_KEY)).toBe('/work/new');

    unmount();
    (useAuthContext as jest.Mock).mockReturnValue(
      auth({ isAuthenticated: true, user: { provider: 'github' } }),
    );
    renderEntry();
    expect(await screen.findByText('Work workspace')).toBeInTheDocument();
    expect(window.sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('does not persist an external redirect from the guest fallback', () => {
    (useAuthContext as jest.Mock).mockReturnValue(auth());
    renderEntry(false, '/connect?redirect_to=%2F%2Fexample.test');
    expect(window.sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it.each([
    ['auth_failed', 'com_auth_error_oauth_failed'],
    ['auth_rate_limited', 'com_auth_error_login_rl'],
    ['auth_banned', 'com_auth_error_login_ban'],
  ])('shows the approved social sign-in error %s and keeps sign-in available', (code, message) => {
    (useAuthContext as jest.Mock).mockReturnValue(auth());
    renderEntry(false, `/connect?redirect=false&error=${code}`);
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByText('Coderax is unavailable')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'com_auth_github_login' })).toBeInTheDocument();
  });

  it('ignores an unrecognized error code', () => {
    (useAuthContext as jest.Mock).mockReturnValue(auth());
    renderEntry(false, '/connect?error=toString');
    expect(screen.getByRole('alert')).toHaveTextContent('Coderax is unavailable');
    expect(screen.queryByText('toString')).not.toBeInTheDocument();
  });

  it('shows the password-only gate instead of entering chat as a guest', () => {
    (useAuthContext as jest.Mock).mockReturnValue(
      auth({ isAuthenticated: true, user: { provider: 'guest' } }),
    );
    renderEntry(true);
    expect(screen.getByLabelText('com_auth_password')).toBeInTheDocument();
    expect(screen.queryByText('Chat workspace')).not.toBeInTheDocument();
  });
});
