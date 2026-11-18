/* eslint-disable i18next/no-literal-string */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom';
import GuestEntry from '../GuestEntry';
import { useAuthContext } from '~/hooks/AuthContext';

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

function renderEntry(passwordLoginEnabled = false) {
  const router = createMemoryRouter(
    [
      {
        element: (
          <Outlet
            context={{
              startupConfig: { passwordLoginEnabled },
              isFetching: false,
            }}
          />
        ),
        children: [
          { path: '/connect', element: <GuestEntry /> },
          { path: '/c/new', element: <div>Chat workspace</div> },
        ],
      },
    ],
    { initialEntries: ['/connect'] },
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

  it('opens chat only after the backend issues an authenticated session', async () => {
    (useAuthContext as jest.Mock).mockReturnValue(
      auth({ isAuthenticated: true, user: { provider: 'local' } }),
    );
    const router = renderEntry();
    await screen.findByText('Chat workspace');
    expect(router.state.location.pathname).toBe('/c/new');
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
