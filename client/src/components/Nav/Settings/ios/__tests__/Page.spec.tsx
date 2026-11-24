import { SettingsTabValues } from 'coderax-data-provider';
import { render, screen, within } from '@testing-library/react';
import type { SectionId, SettingEntry, SettingsContextValue, SettingsTab } from '../../types';
import type { IosPage } from '../pages';
import { registry } from '../../registry';
import PageContent from '../Page';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('../../registry', () => ({ registry: [] }));

const { GENERAL, ACCOUNT, DATA } = SettingsTabValues;

function entry(
  id: string,
  tab: SettingsTab,
  section: SectionId,
  show?: () => boolean,
): SettingEntry {
  return {
    id,
    tab,
    section,
    labelKey: id as SettingEntry['labelKey'],
    Component: () => <div data-testid={`setting-${id}`}>{id}</div>,
    show,
  };
}

/* Only the rows these tests need; the page filters this the same way it
 * filters the real registry. */
registry.push(
  entry('theme', GENERAL, 'appearance'),
  entry('importConversations', DATA, 'data'),
  entry('clearChats', DATA, 'data'),
  entry('deleteAccount', DATA, 'data', () => false),
  entry('revokeKeys', DATA, 'apiKeys'),
  entry('deleteCache', DATA, 'danger'),
  entry('removeAccount', ACCOUNT, 'danger'),
);

const dataControls = {
  id: 'dataControls',
  labelKey: 'com_ui_settings_ios_data_controls',
  icon: null,
  sources: [
    {
      tab: DATA,
      entryIds: ['importConversations', 'clearChats', 'deleteAccount'],
    },
    { tab: DATA, sections: ['apiKeys'] },
  ],
} satisfies IosPage;

/* None of these rows read the context; the page only passes it to their show(). */
const ctx = {} as SettingsContextValue;

describe('iOS settings page content', () => {
  it('renders one card per section with its label as the heading', () => {
    render(<PageContent page={dataControls} ctx={ctx} />);
    expect(
      screen.getByRole('heading', { name: 'com_ui_settings_section_data' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'com_ui_settings_section_api_keys' }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('region')).toHaveLength(2);
  });

  it('keeps entries in registry order inside their section', () => {
    render(<PageContent page={dataControls} ctx={ctx} />);
    const dataCard = screen.getByRole('region', { name: 'com_ui_settings_section_data' });
    const rows = within(dataCard).getAllByTestId(/^setting-/);
    expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual([
      'setting-importConversations',
      'setting-clearChats',
    ]);

    const keysCard = screen.getByRole('region', { name: 'com_ui_settings_section_api_keys' });
    expect(within(keysCard).getByTestId('setting-revokeKeys')).toBeInTheDocument();
  });

  it('leaves out entries the page does not source or the account cannot see', () => {
    render(<PageContent page={dataControls} ctx={ctx} />);
    expect(screen.queryByTestId('setting-theme')).not.toBeInTheDocument();
    expect(screen.queryByTestId('setting-deleteCache')).not.toBeInTheDocument();
    expect(screen.queryByTestId('setting-deleteAccount')).not.toBeInTheDocument();
  });

  it('merges sections that share a label across tabs into one card', () => {
    const dangerPage = {
      id: 'code',
      labelKey: 'com_ui_settings_ios_code',
      icon: null,
      sources: [
        { tab: DATA, sections: ['danger'] },
        { tab: ACCOUNT, sections: ['danger'] },
      ],
    } satisfies IosPage;

    render(<PageContent page={dangerPage} ctx={ctx} />);
    const regions = screen.getAllByRole('region');
    expect(regions).toHaveLength(1);
    const card = regions[0];
    expect(card).toHaveAttribute('aria-label', 'com_ui_settings_section_danger_zone');
    expect(within(card).getByTestId('setting-deleteCache')).toBeInTheDocument();
    expect(within(card).getByTestId('setting-removeAccount')).toBeInTheDocument();
  });

  it('renders a page header above the cards', () => {
    const headerPage = {
      id: 'storage',
      labelKey: 'com_ui_settings_ios_storage',
      icon: null,
      sources: [{ tab: DATA, entryIds: ['revokeKeys'] }],
      header: () => <div data-testid="page-header" />,
    } satisfies IosPage;

    render(<PageContent page={headerPage} ctx={ctx} />);
    const header = screen.getByTestId('page-header');
    const region = screen.getByRole('region');
    expect(header.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
