import { ErrorTypes } from 'coderax-data-provider';
import type { TranslationKeys } from '~/hooks';

/** Error codes the server appends to the login redirect when an OAuth navigation is rejected. */
const oauthErrorKeys: Record<string, TranslationKeys> = {
  [ErrorTypes.AUTH_FAILED]: 'com_auth_error_oauth_failed',
  [ErrorTypes.AUTH_RATE_LIMITED]: 'com_auth_error_login_rl',
  [ErrorTypes.AUTH_BANNED]: 'com_auth_error_login_ban',
};

export function getOAuthErrorKey(error: string | null): TranslationKeys | undefined {
  return error != null && Object.hasOwn(oauthErrorKeys, error) ? oauthErrorKeys[error] : undefined;
}
