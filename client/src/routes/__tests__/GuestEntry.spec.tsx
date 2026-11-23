/* eslint-disable i18next/no-literal-string */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
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

jest.mock('~/hooks/Auth/usePasskey', () => ({
  usePasskeySignIn: () => ({ signIn: jest.fn(), isSigningIn: false }),
}));

const githubConfig = {
  githubLoginEnabled: true,
  socialLoginEnabled: true,
  socialLogins: ['github'],
  serverDomain: 'https://example.test',
};

function clickOAuthLink(link: HTMLElement) {
  // Let React run the real link handler without starting a document navigation in JSDOM.
  document.addEventListener('click', (event) => event.preventDefault(), { once: true });
  fireEvent.click(link);
}

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
  const { unmount } = render(<RouterProvider router={router} />);
  return Object.assign(router, { unmount });
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

  it('saves a valid destination at OAuth activation and consumes it on return', async () => {
    (useAuthContext as jest.Mock).mockReturnValue(auth());
    const { unmount } = renderEntry(false, '/connect?redirect_to=%2Fwork%2Fnew', githubConfig);
    const link = screen.getByRole('link', { name: 'com_auth_github_login' });
    expect(link).toHaveAttribute('href', 'https://example.test/oauth/github');
    expect(window.sessionStorage.getItem(SESSION_KEY)).toBeNull();
    clickOAuthLink(link);
    expect(window.sessionStorage.getItem(SESSION_KEY)).toBe('/work/new');
    unmount();

    (useAuthContext as jest.Mock).mockReturnValue(
      auth({ isAuthenticated: true, user: { provider: 'github' } }),
    );
    renderEntry();
    expect(await screen.findByText('Work workspace')).toBeInTheDocument();
    expect(window.sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it.each(['', '?redirect_to=%2F%2Fexample.test'])(
    'clears an old destination when a fresh OAuth attempt has no safe target (%s)',
    (search) => {
      window.sessionStorage.setItem(SESSION_KEY, '/work/new');
      (useAuthContext as jest.Mock).mockReturnValue(auth());
      renderEntry(false, `/connect${search}`, githubConfig);
      clickOAuthLink(screen.getByRole('link', { name: 'com_auth_github_login' }));
      expect(window.sessionStorage.getItem(SESSION_KEY)).toBeNull();
    },
  );

  it.each([
    ['auth_failed', 'com_auth_error_oauth_failed'],
    ['auth_rate_limited', 'com_auth_error_login_rl'],
    ['auth_banned', 'com_auth_error_login_ban'],
  ])('shows the approved OAuth error %s and keeps sign-in available', (code, message) => {
    (useAuthContext as jest.Mock).mockReturnValue(auth());
    renderEntry(false, `/connect?redirect=false&error=${code}`, githubConfig);
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByText('Coderax is unavailable')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'com_auth_github_login' })).toBeInTheDocument();
  });

  it.each([null, {}])(
    'keeps retry available after an OAuth error without providers (%j)',
    (config) => {
      (useAuthContext as jest.Mock).mockReturnValue(auth());
      renderEntry(false, '/connect?redirect=false&error=auth_failed', config);
      expect(screen.getByRole('alert')).toHaveTextContent('com_auth_error_oauth_failed');
      expect(screen.getByRole('button', { name: 'Retry connection' })).toBeInTheDocument();
    },
  );

  it('ignores an unrecognized OAuth error', () => {
    (useAuthContext as jest.Mock).mockReturnValue(auth());
    renderEntry(false, '/connect?error=toString');
    expect(screen.getByRole('alert')).toHaveTextContent('Coderax is unavailable');
    expect(screen.queryByText('toString')).not.toBeInTheDocument();
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
