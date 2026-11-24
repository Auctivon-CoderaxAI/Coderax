import { createElement } from 'react';
import {
  Bell,
  Database,
  Gauge,
  HardDrive,
  Headphones,
  Info,
  Settings2,
  ShieldCheck,
  Sparkles,
  Terminal,
  UserRound,
} from 'lucide-react';
import { SettingsTabValues } from 'coderax-data-provider';
import type { ReactNode } from 'react';
import type { SectionId, SettingsContextValue, SettingsTab, SettingEntry } from '../types';
import type { TranslationKeys } from '~/hooks';
import { registry } from '../registry';

export type IosPageId =
  | 'account'
  | 'customize'
  | 'general'
  | 'usage'
  | 'notifications'
  | 'voice'
  | 'security'
  | 'code'
  | 'storage'
  | 'dataControls'
  | 'about';

export interface IosSource {
  tab: SettingsTab;
  sections?: SectionId[];
  entryIds?: string[];
}

export interface IosPage {
  id: IosPageId;
  labelKey: TranslationKeys;
  descriptionKey?: TranslationKeys;
  icon: ReactNode;
  sources: IosSource[];
  show?: (ctx: SettingsContextValue) => boolean;
}

const icon = (Icon: typeof Bell): ReactNode =>
  createElement(Icon, { className: 'size-5', 'aria-hidden': true });

/**
 * The mobile settings index, laid out the way the iOS app presents it: an
 * account card, then one leaf per concern instead of the desktop tab rail.
 * Every page reads the same registry the desktop dialog renders, so a setting
 * lives in exactly one place and still appears in both surfaces.
 */
export const IOS_PAGES: IosPage[] = [
  {
    id: 'account',
    labelKey: 'com_nav_setting_account',
    icon: icon(UserRound),
    sources: [{ tab: SettingsTabValues.ACCOUNT, sections: ['profile', 'danger'] }],
  },
  {
    id: 'customize',
    labelKey: 'com_ui_settings_ios_customize',
    descriptionKey: 'com_ui_settings_ios_customize_desc',
    icon: icon(Sparkles),
    sources: [
      { tab: SettingsTabValues.DATA, entryIds: ['referenceSavedMemories'] },
      { tab: SettingsTabValues.CHAT, sections: ['prompts'] },
    ],
  },
  {
    id: 'general',
    labelKey: 'com_nav_setting_general',
    icon: icon(Settings2),
    sources: [
      { tab: SettingsTabValues.GENERAL, sections: ['appearance', 'layout', 'accessibility'] },
    ],
  },
  {
    id: 'usage',
    labelKey: 'com_ui_settings_ios_usage',
    icon: icon(Gauge),
    sources: [{ tab: SettingsTabValues.ACCOUNT, sections: ['billing'] }],
    show: (ctx) => ctx.balanceEnabled,
  },
  {
    id: 'notifications',
    labelKey: 'com_ui_settings_ios_notifications',
    icon: icon(Bell),
    sources: [{ tab: SettingsTabValues.GENERAL, sections: ['notifications'] }],
  },
  {
    id: 'voice',
    labelKey: 'com_ui_settings_ios_voice',
    icon: icon(Headphones),
    sources: [{ tab: SettingsTabValues.SPEECH, sections: ['stt', 'tts'] }],
  },
  {
    id: 'security',
    labelKey: 'com_ui_settings_ios_security',
    icon: icon(ShieldCheck),
    sources: [
      {
        tab: SettingsTabValues.ACCOUNT,
        entryIds: ['changeEmail', 'twoFactor', 'backupCodes', 'passkeys'],
      },
    ],
  },
  {
    id: 'code',
    labelKey: 'com_ui_settings_ios_code',
    descriptionKey: 'com_ui_settings_ios_code_desc',
    icon: icon(Terminal),
    sources: [{ tab: SettingsTabValues.DATA, sections: ['codeExecution'] }],
  },
  {
    id: 'storage',
    labelKey: 'com_ui_settings_ios_storage',
    icon: icon(HardDrive),
    sources: [{ tab: SettingsTabValues.DATA, entryIds: ['manageFiles', 'deleteCache'] }],
  },
  {
    id: 'dataControls',
    labelKey: 'com_ui_settings_ios_data_controls',
    icon: icon(Database),
    sources: [
      {
        tab: SettingsTabValues.DATA,
        entryIds: ['importConversations', 'sharedLinks', 'archiveAllChats', 'clearChats'],
      },
      { tab: SettingsTabValues.DATA, sections: ['apiKeys'] },
    ],
  },
  {
    id: 'about',
    labelKey: 'com_nav_setting_about',
    icon: icon(Info),
    sources: [{ tab: SettingsTabValues.ABOUT, sections: ['about'] }],
  },
];

function matchesSource(entry: SettingEntry, source: IosSource): boolean {
  if (entry.tab !== source.tab) {
    return false;
  }
  if (source.entryIds?.includes(entry.id)) {
    return true;
  }
  return source.sections?.includes(entry.section) ?? false;
}

/** Entries a page actually shows for this account right now. */
export function pageEntries(page: IosPage, ctx: SettingsContextValue): SettingEntry[] {
  return registry.filter(
    (entry) =>
      page.sources.some((source) => matchesSource(entry, source)) &&
      (!entry.show || entry.show(ctx)),
  );
}

export function pageVisible(page: IosPage, ctx: SettingsContextValue): boolean {
  if (page.show && !page.show(ctx)) {
    return false;
  }
  return pageEntries(page, ctx).length > 0;
}

export function findPage(id: IosPageId): IosPage | undefined {
  return IOS_PAGES.find((page) => page.id === id);
}
