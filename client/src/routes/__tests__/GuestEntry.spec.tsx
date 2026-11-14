/* eslint-disable i18next/no-literal-string */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import GuestEntry from '../GuestEntry';
import { useAuthContext } from '~/hooks/AuthContext';

jest.mock('~/hooks/AuthContext', () => ({
  useAuthContext: jest.fn(),
}));

function renderEntry() {
  const router = createMemoryRouter(
    [
      { path: '/connect', element: <GuestEntry /> },
      { path: '/c/new', element: <div>Chat workspace</div> },
    ],
    { initialEntries: ['/connect'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe('passwordless guest entry', () => {
  beforeEach(() => jest.clearAllMocks());

  it('never renders the old login form while a guest session is being requested', () => {
    (useAuthContext as jest.Mock).mockReturnValue({
      isAuthReady: false,
      isAuthenticated: false,
    });
    renderEntry();
    expect(screen.getByRole('status')).toHaveTextContent('Opening Coderax');
    expect(screen.queryByText('Welcome back')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('shows an honest server-unavailable state rather than a password form', () => {
    (useAuthContext as jest.Mock).mockReturnValue({
      isAuthReady: true,
      isAuthenticated: false,
    });
    renderEntry();
    expect(screen.getByRole('alert')).toHaveTextContent('Coderax is unavailable');
    expect(screen.getByRole('button', { name: 'Retry connection' })).toBeInTheDocument();
    expect(screen.queryByText('Welcome back')).not.toBeInTheDocument();
  });

  it('opens chat only after the backend issues an authenticated session', async () => {
    (useAuthContext as jest.Mock).mockReturnValue({
      isAuthReady: true,
      isAuthenticated: true,
    });
    const router = renderEntry();
    await screen.findByText('Chat workspace');
    expect(router.state.location.pathname).toBe('/c/new');
  });
});
