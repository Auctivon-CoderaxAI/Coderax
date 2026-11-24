import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import type { SettingsContextValue } from '../../types';
import type { TUser } from 'coderax-data-provider';
import Overview from '../Overview';

const mockLogout = jest.fn();
const mockAuth: { user: TUser | null; logout: jest.Mock } = {
  user: { id: 'user-1', name: 'Ada Lovelace', username: 'ada' } as TUser,
  logout: mockLogout,
};

jest.mock('@coderax/client', () => ({
  Avatar: () => <span data-testid="account-avatar" />,
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useAuthContext: () => mockAuth,
}));

const ctx: SettingsContextValue = {
  balanceEnabled: false,
  hasAnyPersonalizationFeature: false,
  hasMemoryOptOut: false,
  hasStatefulCodeSessions: false,
  hasRemoteAgents: false,
  hasUserProvidedEndpoints: false,
  hasMultiConvo: false,
  hasPrompts: false,
  isLocalProvider: true,
  emailEnabled: true,
  allowEmailChange: true,
  passkeyLoginEnabled: false,
  isTwoFactorPolicyProvider: true,
  twoFactorEnabled: false,
  allowAccountDeletion: true,
  aboutEnabled: false,
  engineTTS: 'browser',
  langfuseConnectionAccess: false,
  cyvoxConnectionAccess: false,
  adminPanelURL: '',
  replyTabBadgeAllowed: true,
  replyNotificationsAllowed: true,
  replyNotificationSoundAllowed: true,
};

function setup(overrides: Partial<SettingsContextValue> = {}) {
  const onOpen = jest.fn();
  const onClose = jest.fn();
  const onQueryChange = jest.fn();
  render(
    <Overview
      ctx={{ ...ctx, ...overrides }}
      onOpen={onOpen}
      onClose={onClose}
      onQueryChange={onQueryChange}
    />,
  );
  return { onOpen, onClose, onQueryChange };
}

function rowIds(): string[] {
  return screen
    .queryAllByTestId(/^ios-settings-/)
    .map((row) => row.getAttribute('data-testid') ?? '');
}

describe('iOS settings overview', () => {
  afterEach(() => {
    mockAuth.user = { id: 'user-1', name: 'Ada Lovelace', username: 'ada' } as TUser;
  });

  it('lists the account, customize and main pages in the iOS order', () => {
    setup();
    expect(rowIds()).toEqual([
      'ios-settings-account',
      'ios-settings-customize',
      'ios-settings-general',
      'ios-settings-chat',
      'ios-settings-notifications',
      'ios-settings-voice',
      'ios-settings-security',
      'ios-settings-code',
      'ios-settings-storage',
      'ios-settings-dataControls',
    ]);
  });

  it('shows the account name and avatar on the account row', () => {
    setup();
    const account = screen.getByTestId('ios-settings-account');
    expect(account).toHaveTextContent('Ada Lovelace');
    expect(screen.getByTestId('account-avatar')).toBeInTheDocument();
  });

  it('places usage between chat and notifications when credits are enabled', () => {
    setup({ balanceEnabled: true });
    const ids = rowIds();
    expect(ids.indexOf('ios-settings-usage')).toBe(ids.indexOf('ios-settings-chat') + 1);
    expect(ids.indexOf('ios-settings-usage')).toBe(ids.indexOf('ios-settings-notifications') - 1);
  });

  it('leaves usage out when the deployment has no balance', () => {
    setup({ balanceEnabled: false });
    expect(screen.queryByTestId('ios-settings-usage')).not.toBeInTheDocument();
  });

  it('shows Langfuse and CyVox only where the account has access', () => {
    setup({ langfuseConnectionAccess: true, cyvoxConnectionAccess: true });
    expect(screen.getByTestId('ios-settings-langfuse')).toBeInTheDocument();
    expect(screen.getByTestId('ios-settings-cyvox')).toBeInTheDocument();
  });

  it('hides Langfuse and CyVox by default', () => {
    setup();
    expect(screen.queryByTestId('ios-settings-langfuse')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ios-settings-cyvox')).not.toBeInTheDocument();
  });

  it('shows About after the main group when build information is on', () => {
    setup({ aboutEnabled: true });
    expect(rowIds().at(-1)).toBe('ios-settings-about');
  });

  it('opens the row it is given and clears the search first', async () => {
    const { onOpen, onQueryChange } = setup();
    await userEvent.click(screen.getByTestId('ios-settings-customize'));
    expect(onQueryChange).toHaveBeenCalledWith('');
    expect(onOpen).toHaveBeenCalledWith('customize');
  });

  it('logs out and closes the dialog from the last row', async () => {
    const { onClose } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'com_nav_log_out' }));
    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('drops the account value and the log-out row when signed out', () => {
    mockAuth.user = null;
    setup();
    expect(screen.getByTestId('ios-settings-account')).toBeInTheDocument();
    expect(screen.queryByTestId('account-avatar')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'com_nav_log_out' })).not.toBeInTheDocument();
  });
});
