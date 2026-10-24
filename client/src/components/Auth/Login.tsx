import { useEffect, useState } from 'react';
import { OpenIDIcon, useToastContext } from '@coderax/client';
import { apiBaseUrl, ErrorTypes, registerPage } from 'coderax-data-provider';
import { useOutletContext, useSearchParams, useLocation } from 'react-router-dom';
import type { TLoginLayoutContext } from '~/common';
import type { TranslationKeys } from '~/hooks';
import { getLoginError, persistRedirectToSession } from '~/utils';
import { ErrorMessage } from '~/components/Auth/ErrorMessage';
import SocialButton from '~/components/Auth/SocialButton';
import { useAuthContext } from '~/hooks/AuthContext';
import { useLocalize } from '~/hooks';
import LoginForm from './LoginForm';

interface LoginLocationState {
  redirect_to?: string;
}

/** Error codes the server appends to the login redirect when an OAuth navigation is rejected. */
const oauthErrorKeys: Record<string, TranslationKeys> = {
  [ErrorTypes.AUTH_FAILED]: 'com_auth_error_oauth_failed',
  [ErrorTypes.AUTH_RATE_LIMITED]: 'com_auth_error_login_rl',
  [ErrorTypes.AUTH_BANNED]: 'com_auth_error_login_ban',
};

function Login() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { error, setError, login, isAuthReady, isAuthenticated, completeAuthentication } =
    useAuthContext();
  const { startupConfig } = useOutletContext<TLoginLayoutContext>();

  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const disableAutoRedirect = searchParams.get('redirect') === 'false';

  const [isAutoRedirectDisabled, setIsAutoRedirectDisabled] = useState(disableAutoRedirect);
  const [guestAttemptPending, setGuestAttemptPending] = useState(true);
  const manualSignIn = searchParams.get('manual') === '1';

  useEffect(() => {
    const redirectTo = searchParams.get('redirect_to');
    if (redirectTo) {
      persistRedirectToSession(redirectTo);
    } else {
      const state = location.state as LoginLocationState | null;
      if (state?.redirect_to) {
        persistRedirectToSession(state.redirect_to);
      }
    }

    const oauthError = searchParams?.get('error');
    /** `hasOwn` keeps an attacker-supplied `?error=toString` off the prototype chain. */
    const oauthErrorKey =
      oauthError != null && Object.hasOwn(oauthErrorKeys, oauthError)
        ? oauthErrorKeys[oauthError]
        : undefined;
    if (oauthErrorKey != null) {
      showToast({
        message: localize(oauthErrorKey),
        status: 'error',
      });
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('error');
      setSearchParams(newParams, { replace: true });
    }
  }, [searchParams, setSearchParams, showToast, localize, location.state]);

  useEffect(() => {
    if (disableAutoRedirect) {
      setIsAutoRedirectDisabled(true);
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('redirect');
      setSearchParams(newParams, { replace: true });
    }
  }, [disableAutoRedirect, searchParams, setSearchParams]);

  const shouldAutoRedirect =
    startupConfig?.openidLoginEnabled &&
    startupConfig?.openidAutoRedirect &&
    startupConfig?.serverDomain &&
    !isAutoRedirectDisabled;

  useEffect(() => {
    if (shouldAutoRedirect) {
      console.log('Auto-redirecting to OpenID provider...');
      window.location.href = `${startupConfig.serverDomain}/oauth/openid`;
    }
  }, [shouldAutoRedirect, startupConfig]);

  // Sign in without a form when the backend explicitly permits isolated guest sessions.
  // Keep a manual login escape hatch for existing account holders.
  useEffect(() => {
    if (!isAuthReady || isAuthenticated || manualSignIn || shouldAutoRedirect) {
      return;
    }

    const controller = new AbortController();
    fetch(`${apiBaseUrl()}/api/auth/guest`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('Guest sessions are unavailable');
        }
        return response.json();
      })
      .then((session) => {
        if (controller.signal.aborted) {
          return;
        }
        if (!session?.token || !session?.user) {
          throw new Error('Invalid guest session response');
        }
        completeAuthentication(session.token, session.user);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setGuestAttemptPending(false);
        }
      });

    return () => controller.abort();
  }, [isAuthReady, isAuthenticated, manualSignIn, shouldAutoRedirect, completeAuthentication]);

  if (shouldAutoRedirect) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-4">
        <p className="text-lg font-semibold">
          {localize('com_ui_redirecting_to_provider', { 0: startupConfig.openidLabel })}
        </p>
        <div className="mt-4">
          <SocialButton
            key="openid"
            enabled={startupConfig.openidLoginEnabled}
            serverDomain={startupConfig.serverDomain}
            oauthPath="openid"
            Icon={() =>
              startupConfig.openidImageUrl ? (
                <img src={startupConfig.openidImageUrl} alt="OpenID Logo" className="h-5 w-5" />
              ) : (
                <OpenIDIcon />
              )
            }
            label={startupConfig.openidLabel}
            id="openid"
          />
        </div>
      </div>
    );
  }

  if (!manualSignIn && (!isAuthReady || guestAttemptPending)) {
    return (
      <div className="text-text-secondary py-6 text-center" role="status">
        Opening Coderax…
      </div>
    );
  }

  return (
    <>
      {error != null && <ErrorMessage>{localize(getLoginError(error))}</ErrorMessage>}
      {startupConfig?.emailLoginEnabled === true && (
        <LoginForm
          onSubmit={login}
          startupConfig={startupConfig}
          error={error}
          setError={setError}
        />
      )}
      {startupConfig?.registrationEnabled === true && (
        <p className="text-text-secondary my-4 text-center text-sm font-light">
          {' '}
          {localize('com_auth_no_account')}{' '}
          <a
            href={registerPage()}
            className="text-accent-primary hover:text-accent-primary-hover hover:decoration-accent-primary-hover focus:text-accent-primary-hover focus:decoration-accent-primary-hover inline-flex p-1 text-sm font-medium underline decoration-transparent transition-all duration-200"
          >
            {localize('com_auth_sign_up')}
          </a>
        </p>
      )}
    </>
  );
}

export default Login;
