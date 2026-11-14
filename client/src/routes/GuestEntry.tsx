import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthContext } from '~/hooks/AuthContext';

/**
 * Passwordless entry screen. A valid isolated guest session is established by
 * AuthContext before navigating into chat; never render protected user data
 * without a server-issued session.
 *
 * This page deliberately has no password form or welcome-back message.
 */
export default function GuestEntry() {
  const navigate = useNavigate();
  const { isAuthReady, isAuthenticated } = useAuthContext();

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/c/new', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  if (!isAuthReady || isAuthenticated) {
    return (
      <div role="status" className="text-text-secondary space-y-2 text-center">
        <p className="text-text-primary text-lg font-semibold">Opening Coderax…</p>
        <p>Connecting to your workspace.</p>
      </div>
    );
  }

  return (
    <div role="alert" className="text-text-secondary space-y-4 text-center">
      <p className="text-text-primary text-lg font-semibold">Coderax is unavailable</p>
      <p>We couldn't establish a guest session with the server. Your workspace is protected; no sign-in is required when guest access is available.</p>
      <button
        className="bg-surface-tertiary text-text-primary rounded-lg px-4 py-2 font-medium"
        type="button"
        onClick={() => window.location.reload()}
      >
        Retry connection
      </button>
    </div>
  );
}
