import { createElement } from 'react';
import { SettingsTabValues } from 'coderax-data-provider';
import {
  Activity,
  Bell,
  Bot,
  Database,
  Gauge,
  HardDrive,
  Headphones,
  MessageSquare,
  Info,
  Settings2,
  ShieldCheck,
  Sparkles,
  Terminal,
  UserRound,
} from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import type { SectionId, SettingsContextValue, SettingsTab, SettingEntry } from '../types';
import type { TranslationKeys } from '~/hooks';
import StorageUsage from './StorageUsage';
import { matchesQuery } from '../search';
import { registry } from '../registry';

export type IosPageId =
  | 'account'
  | 'customize'
  | 'general'
  | 'chat'
  | 'usage'
  | 'notifications'
  | 'voice'
  | 'security'
  | 'code'
  | 'storage'
  | 'dataControls'
  | 'langfuse'
  | 'cyvox'
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
  /** Page-level content shown above the registry rows, for summaries. */
  header?: ComponentType;
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
    sources: [{ tab: SettingsTabValues.ACCOUNT, sections: ['profile'] }],
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
      {
        tab: SettingsTabValues.GENERAL,
        sections: ['appearance', 'layout', 'accessibility', 'admin'],
      },
    ],
  },
  {
    id: 'chat',
    labelKey: 'com_nav_setting_chat',
    icon: icon(MessageSquare),
    sources: [{ tab: SettingsTabValues.CHAT }],
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
    sources: [
      { tab: SettingsTabValues.DATA, sections: ['codeExecution'] },
      {
        tab: SettingsTabValues.CHAT,
        entryIds: ['duringRunDefaultAction', 'autoExpandTools', 'showThinking'],
      },
    ],
  },
  {
    id: 'storage',
    labelKey: 'com_ui_settings_ios_storage',
    icon: icon(HardDrive),
    header: StorageUsage,
    sources: [{ tab: SettingsTabValues.DATA, entryIds: ['manageFiles', 'deleteCache'] }],
  },
  {
    id: 'dataControls',
    labelKey: 'com_ui_settings_ios_data_controls',
    icon: icon(Database),
    sources: [
      {
        tab: SettingsTabValues.DATA,
        entryIds: [
          'importConversations',
          'sharedLinks',
          'archivedChats',
          'archiveAllChats',
          'clearChats',
          'deleteAccount',
        ],
      },
      { tab: SettingsTabValues.DATA, sections: ['apiKeys'] },
      { tab: SettingsTabValues.ACCOUNT, entryIds: ['deleteAccount'] },
    ],
  },
  {
    id: 'langfuse',
    labelKey: 'com_ui_settings_tab_langfuse',
    icon: icon(Activity),
    sources: [{ tab: SettingsTabValues.LANGFUSE }],
    show: (ctx) => ctx.langfuseConnectionAccess,
  },
  {
    id: 'cyvox',
    labelKey: 'com_ui_settings_tab_cyvox',
    icon: icon(Bot),
    sources: [{ tab: SettingsTabValues.CYVOX }],
    show: (ctx) => ctx.cyvoxConnectionAccess,
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
  if (source.entryIds == null && source.sections == null) {
    /* A source that names no section or entry means the whole tab. */
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

export interface PageSearchResult {
  page: IosPage;
  /** The rows on this page that matched; empty when only the page title did. */
  matches: { entry: SettingEntry; label: string }[];
}

/**
 * Search every visible page, not the desktop tab the dialog happens to be on, so
 * the mobile index can offer whole destinations instead of loose controls. A page
 * matches on its own title as well as its rows, because several pages label their
 * rows by what they change rather than by the concern the page is named after.
 */
export function searchPages(
  query: string,
  ctx: SettingsContextValue,
  localize: (key: TranslationKeys) => string,
): PageSearchResult[] {
  if (query.trim() === '') {
    return [];
  }
  const results: PageSearchResult[] = [];
  for (const page of IOS_PAGES) {
    if (page.show && !page.show(ctx)) {
      continue;
    }
    const matches = pageEntries(page, ctx)
      .filter((entry) =>
        matchesQuery(query, { label: localize(entry.labelKey), keywords: entry.keywords }),
      )
      .map((entry) => ({ entry, label: localize(entry.labelKey) }));
    const titleMatches = matchesQuery(query, {
      label: localize(page.labelKey),
      keywords: page.descriptionKey != null ? [localize(page.descriptionKey)] : undefined,
    });
    if (matches.length === 0 && !titleMatches) {
      continue;
    }
    results.push({ page, matches });
  }
  return results;
}
