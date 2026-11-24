/* eslint-disable i18next/no-literal-string */
import { useEffect, type MouseEventHandler } from 'react';
import { useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import type { TLoginLayoutContext } from '~/common';
import {
  clearPostLoginRedirect,
  getPostLoginRedirect,
  isSafeRedirect,
  persistRedirectToSession,
  REDIRECT_PARAM,
} from '~/utils';
import PasswordLoginForm from '~/components/Auth/PasswordLoginForm';
import SocialLoginRender from '~/components/Auth/SocialLoginRender';
import { getOAuthErrorKey } from '~/components/Auth/oauthError';
import { useAuthContext } from '~/hooks/AuthContext';
import { useLocalize } from '~/hooks';

/**
 * Entry screen for passwordless guests and password-only owners. When the
 * server advertises password login, only an owner session opens the workspace;
 * a guest session must not bypass the owner password gate.
 */
export default function GuestEntry() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const { startupConfig, startupConfigError, isFetching } = useOutletContext<TLoginLayoutContext>();
  const { isAuthReady, isAuthenticated, user } = useAuthContext();
  const localize = useLocalize();
  const configReady = startupConfig != null && startupConfigError == null && !isFetching;
  const passwordLoginEnabled = startupConfig?.passwordLoginEnabled === true;
  const isOwner = isAuthenticated && !!user && user.provider !== 'guest';
  const shouldEnterWorkspace =
    configReady && isAuthReady && isAuthenticated && (!passwordLoginEnabled || isOwner);

  const searchParams = new URLSearchParams(search);
  const oauthErrorKey = getOAuthErrorKey(searchParams.get('error'));
  const prepareSocialSignIn: MouseEventHandler<HTMLAnchorElement> = (event) => {
    // A modified click opens a separate tab and does not start a handoff in this tab.
    if (
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    const destination = searchParams.get(REDIRECT_PARAM);
    if (destination && isSafeRedirect(destination)) {
      persistRedirectToSession(destination);
    } else {
      clearPostLoginRedirect();
    }
  };

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

  if (configReady && passwordLoginEnabled) {
    return <PasswordLoginForm />;
  }

  return (
    <div role="alert" className="text-text-secondary space-y-4 text-center">
      <p className="text-text-primary text-lg font-semibold">
        {oauthErrorKey ? localize(oauthErrorKey) : 'Coderax is unavailable'}
      </p>
      {configReady ? (
        <>
          {!oauthErrorKey && (
            <p>
              We could not establish a guest session with the server. Your workspace is protected;
              no sign-in is required when guest access is available.
            </p>
          )}
          <SocialLoginRender
            startupConfig={startupConfig}
            showPasskey
            showEmailDivider={false}
            onSocialSignIn={prepareSocialSignIn}
          />
        </>
      ) : (
        <p>{localize('com_auth_error_login_server')}</p>
      )}
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
