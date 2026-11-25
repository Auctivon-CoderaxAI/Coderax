import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import type { SettingsContextValue } from '../../types';
import SearchResults from '../Search';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

/* Every capability on, so no page is hidden for a reason other than the query. */
const ctx: SettingsContextValue = {
  balanceEnabled: true,
  hasAnyPersonalizationFeature: true,
  hasMemoryOptOut: true,
  hasStatefulCodeSessions: true,
  hasRemoteAgents: true,
  hasUserProvidedEndpoints: true,
  hasMultiConvo: true,
  hasPrompts: true,
  isLocalProvider: true,
  emailEnabled: true,
  allowEmailChange: true,
  passkeyLoginEnabled: true,
  isTwoFactorPolicyProvider: true,
  twoFactorEnabled: true,
  allowAccountDeletion: true,
  aboutEnabled: true,
  engineTTS: 'browser',
  langfuseConnectionAccess: true,
  cyvoxConnectionAccess: true,
  adminPanelURL: 'https://admin.example.com',
  replyTabBadgeAllowed: true,
  replyNotificationsAllowed: true,
  replyNotificationSoundAllowed: true,
};

describe('mobile settings search', () => {
  it('finds a page from a row that lives on another desktop tab', () => {
    render(<SearchResults ctx={ctx} query="archive" onOpen={jest.fn()} />);

    /* Archiving lives in the Data tab; the page that owns it is Data controls. */
    expect(screen.getByTestId('ios-search-result-dataControls')).toBeInTheDocument();
  });

  it('lists the matching rows under their page', () => {
    render(<SearchResults ctx={ctx} query="archive" onOpen={jest.fn()} />);

    const result = screen.getByTestId('ios-search-result-dataControls');
    expect(result).toHaveTextContent('com_nav_archived_chats');
    expect(result).toHaveTextContent('com_ui_settings_label_archive_all_chats');
  });

  it('matches a page by its own title', () => {
    render(<SearchResults ctx={ctx} query="customize" onOpen={jest.fn()} />);

    const result = screen.getByTestId('ios-search-result-customize');
    expect(result).toHaveTextContent('com_ui_settings_ios_customize_desc');
  });

  it('leaves out pages without a match and reports an empty result', () => {
    render(<SearchResults ctx={ctx} query="zzz" onOpen={jest.fn()} />);

    expect(screen.queryByTestId('ios-search-result-dataControls')).not.toBeInTheDocument();
    expect(screen.getByText('com_ui_settings_no_results')).toBeInTheDocument();
  });

  it('opens the page a result belongs to', async () => {
    const onOpen = jest.fn();
    render(<SearchResults ctx={ctx} query="archive" onOpen={onOpen} />);

    await userEvent.click(screen.getByTestId('ios-search-result-dataControls'));
    expect(onOpen).toHaveBeenCalledWith('dataControls');
  });
});
