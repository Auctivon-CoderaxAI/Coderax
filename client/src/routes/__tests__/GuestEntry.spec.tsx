/* eslint-disable i18next/no-literal-string */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom';
import { useAuthContext } from '~/hooks/AuthContext';
import GuestEntry from '../GuestEntry';

jest.mock('~/hooks/AuthContext', () => ({
  useAuthContext: jest.fn(),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('~/hooks/Auth/usePasskey', () => ({
  usePasskeySignIn: () => ({ signIn: jest.fn(), isSigningIn: false }),
}));

const auth = (overrides: Record<string, unknown> = {}) => ({
  isAuthReady: true,
  isAuthenticated: false,
  user: undefined,
  passwordLogin: jest.fn(),
  passwordLoginError: undefined,
  ...overrides,
});

function renderEntry(
  passwordLoginEnabled = false,
  initialEntry = '/connect',
  startupConfig: Record<string, unknown> | null = {},
  query: { isFetching?: boolean; startupConfigError?: Error } = {},
) {
  const router = createMemoryRouter(
    [
      {
        element: (
          <Outlet
            context={{
              startupConfig: startupConfig && { passwordLoginEnabled, ...startupConfig },
              isFetching: false,
              ...query,
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
  render(<RouterProvider router={router} />);
  return router;
}

describe('guest and password entry', () => {
  beforeEach(() => jest.clearAllMocks());

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

  it('honors redirect_to when an authenticated user arrives', async () => {
    (useAuthContext as jest.Mock).mockReturnValue(
      auth({ isAuthenticated: true, user: { provider: 'local' } }),
    );
    const router = renderEntry(false, '/connect?redirect_to=%2Fwork%2Fnew');
    await screen.findByText('Work workspace');
    expect(router.state.location.pathname).toBe('/work/new');
  });

  it('opens chat only after the backend issues an authenticated session', async () => {
    (useAuthContext as jest.Mock).mockReturnValue(
      auth({ isAuthenticated: true, user: { provider: 'local' } }),
    );
    const router = renderEntry();
    await screen.findByText('Chat workspace');
    expect(router.state.location.pathname).toBe('/c/new');
  });

  it('offers configured sign-in methods when no guest session is available', () => {
    (useAuthContext as jest.Mock).mockReturnValue(auth());
    renderEntry(false, '/connect', {
      emailLoginEnabled: true,
      socialLoginEnabled: true,
      socialLogins: ['google'],
      googleLoginEnabled: true,
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Coderax is unavailable');
    expect(screen.getByRole('button', { name: 'Retry connection' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'com_auth_google_login' })).toBeInTheDocument();
    expect(screen.queryByText('com_auth_or')).not.toBeInTheDocument();
  });

  it('offers passkey sign-in when the deployment configures it for /connect', () => {
    (useAuthContext as jest.Mock).mockReturnValue(auth());
    renderEntry(false, '/connect', { passkeyLoginEnabled: true });
    expect(screen.getByRole('alert')).toHaveTextContent('Coderax is unavailable');
    expect(screen.getByRole('button', { name: 'Retry connection' })).toBeInTheDocument();
    expect(screen.getByTestId('passkey')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'com_auth_passkey_login' })).toBeInTheDocument();
    expect(screen.queryByText('com_auth_or')).not.toBeInTheDocument();
  });

  it.each([null, {}])(
    'keeps an authenticated guest on /connect while config loads (%j)',
    (config) => {
      (useAuthContext as jest.Mock).mockReturnValue(
        auth({ isAuthenticated: true, user: { provider: 'guest' } }),
      );
      const router = renderEntry(false, '/connect?redirect_to=%2Fwork%2Fnew', config, {
        isFetching: true,
      });
      expect(router.state.location.pathname).toBe('/connect');
      expect(screen.getByRole('status')).toBeInTheDocument();
    },
  );

  it.each([null, {}])(
    'offers retry after a config error without redirecting a guest (%j)',
    (config) => {
      (useAuthContext as jest.Mock).mockReturnValue(
        auth({ isAuthenticated: true, user: { provider: 'guest' } }),
      );
      const router = renderEntry(false, '/connect', config, {
        startupConfigError: new Error('config unavailable'),
      });
      expect(router.state.location.pathname).toBe('/connect');
      expect(screen.getByText('com_auth_error_login_server')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Retry connection' })).toBeInTheDocument();
    },
  );

  it('opens the workspace for a guest once config confirms password login is disabled', async () => {
    (useAuthContext as jest.Mock).mockReturnValue(
      auth({ isAuthenticated: true, user: { provider: 'guest' } }),
    );
    const router = renderEntry(false, '/connect?redirect_to=%2Fwork%2Fnew');
    await screen.findByText('Work workspace');
    expect(router.state.location.pathname).toBe('/work/new');
  });

  it('requires the owner password when a guest session exists and password login is advertised', () => {
    (useAuthContext as jest.Mock).mockReturnValue(
      auth({ isAuthenticated: true, user: { provider: 'guest' } }),
    );
    const router = renderEntry(true);
    expect(screen.getByLabelText('com_auth_password')).toBeInTheDocument();
    expect(screen.queryByText('Coderax is unavailable')).not.toBeInTheDocument();
    expect(screen.queryByText('Chat workspace')).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/connect');
  });

  it('opens the workspace for an owner when password login is advertised', async () => {
    (useAuthContext as jest.Mock).mockReturnValue(
      auth({ isAuthenticated: true, user: { provider: 'local' } }),
    );
    const router = renderEntry(true);
    await screen.findByText('Chat workspace');
    expect(router.state.location.pathname).toBe('/c/new');
  });

  it('keeps the password form for a visitor with no session when guest access is off', () => {
    (useAuthContext as jest.Mock).mockReturnValue(auth());
    renderEntry(true);
    expect(screen.getByLabelText('com_auth_password')).toBeInTheDocument();
    expect(screen.queryByText('Chat workspace')).not.toBeInTheDocument();
  });
});
