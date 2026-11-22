/* eslint-disable i18next/no-literal-string */
import { useEffect } from 'react';
import { useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import type { TLoginLayoutContext } from '~/common';
import PasswordLoginForm from '~/components/Auth/PasswordLoginForm';
import SocialLoginRender from '~/components/Auth/SocialLoginRender';
import { useAuthContext } from '~/hooks/AuthContext';
import { getPostLoginRedirect } from '~/utils';

/**
 * Entry screen for passwordless guests and password-only owners. When the
 * server advertises password login, only an owner session opens the workspace;
 * a guest session must not bypass the owner password gate.
 */
export default function GuestEntry() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const { startupConfig, isFetching } = useOutletContext<TLoginLayoutContext>();
  const { isAuthReady, isAuthenticated, user } = useAuthContext();
  const passwordLoginEnabled =
    (startupConfig as { passwordLoginEnabled?: boolean } | null)?.passwordLoginEnabled === true;
  const isOwner = isAuthenticated && !!user && user.provider !== 'guest';
  const shouldEnterWorkspace = isAuthenticated && (!passwordLoginEnabled || isOwner);

  useEffect(() => {
    if (shouldEnterWorkspace) {
      const destination = getPostLoginRedirect(new URLSearchParams(search)) ?? '/c/new';
      navigate(destination, { replace: true });
    }
  }, [shouldEnterWorkspace, navigate, search]);

  if (!isAuthReady || isFetching || shouldEnterWorkspace) {
    return (
      <div role="status" className="text-text-secondary space-y-2 text-center">
        <p className="text-text-primary text-lg font-semibold">Opening Coderax…</p>
        <p>Connecting to your workspace.</p>
      </div>
    );
  }

  if (passwordLoginEnabled) {
    return <PasswordLoginForm />;
  }

  return (
    <div role="alert" className="text-text-secondary space-y-4 text-center">
      <p className="text-text-primary text-lg font-semibold">Coderax is unavailable</p>
      <p>
        We could not establish a guest session with the server. Your workspace is protected; no
        sign-in is required when guest access is available.
      </p>
      <SocialLoginRender startupConfig={startupConfig} showPasskey showEmailDivider={false} />
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
