import { isEnabled } from '../utils/common';

export interface GuestSessionPolicy {
  passwordLoginEnabled: boolean;
  guestAccessEnabled?: string | boolean | null;
  enforceTwoFactorAuthentication?: string | boolean | null;
}

/** Guest sessions are only available when explicitly enabled and owner auth is off. */
export function canCreateGuestSession(policy: GuestSessionPolicy): boolean {
  return (
    !policy.passwordLoginEnabled &&
    isEnabled(policy.guestAccessEnabled) &&
    !isEnabled(policy.enforceTwoFactorAuthentication)
  );
}
