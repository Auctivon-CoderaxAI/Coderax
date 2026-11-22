import { canCreateGuestSession } from './guestAccess';

describe('canCreateGuestSession', () => {
  const guestEnabled = {
    passwordLoginEnabled: false,
    guestAccessEnabled: 'true',
    enforceTwoFactorAuthentication: 'false',
  };

  it('allows an explicitly enabled guest session when owner auth and mandatory 2FA are off', () => {
    expect(canCreateGuestSession(guestEnabled)).toBe(true);
  });

  it('keeps guests out when owner password login is enabled', () => {
    expect(canCreateGuestSession({ ...guestEnabled, passwordLoginEnabled: true })).toBe(false);
  });

  it('requires guest access to be explicitly enabled', () => {
    expect(canCreateGuestSession({ ...guestEnabled, guestAccessEnabled: undefined })).toBe(false);
  });

  it('does not let guests bypass mandatory two-factor authentication', () => {
    expect(canCreateGuestSession({ ...guestEnabled, enforceTwoFactorAuthentication: 'true' })).toBe(
      false,
    );
  });
});
