import { SettingsTabValues } from 'coderax-data-provider';
import type { SettingsContextValue } from '../../types';
import type { IosPageId } from '../pages';
import { IOS_PAGES, findPage, pageEntries, pageVisible } from '../pages';
import en from '~/locales/en/translation.json';
import { registry } from '../../registry';

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

function contextFor(overrides: Partial<SettingsContextValue> = {}): SettingsContextValue {
  return { ...ctx, ...overrides };
}

function pageFor(id: IosPageId) {
  const page = findPage(id);
  if (page == null) {
    throw new Error(`${id} is not an iOS settings page`);
  }
  return page;
}

function entryIds(id: IosPageId, overrides: Partial<SettingsContextValue> = {}): string[] {
  return pageEntries(pageFor(id), contextFor(overrides)).map((entry) => entry.id);
}

function pageShown(id: IosPageId, overrides: Partial<SettingsContextValue> = {}): boolean {
  return pageVisible(pageFor(id), contextFor(overrides));
}

describe('iOS settings pages', () => {
  it('lists each page once and carries English copy for its header', () => {
    const ids = IOS_PAGES.map((page) => page.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const page of IOS_PAGES) {
      expect(en).toHaveProperty(page.labelKey);
      if (page.descriptionKey != null) {
        expect(en).toHaveProperty(page.descriptionKey);
      }
    }
  });

  it('resolves a page by id and rejects an unknown one', () => {
    expect(findPage('storage')?.labelKey).toBe('com_ui_settings_ios_storage');
    expect(findPage('nope' as IosPageId)).toBeUndefined();
  });

  it('reads only the entries its sources name', () => {
    const ids = entryIds('account');
    expect(ids).toContain('avatar');
    /* Theme belongs to General, which the account page does not source. */
    expect(ids).not.toContain('theme');
  });

  describe('usage', () => {
    it('is hidden until the deployment reports a balance', () => {
      expect(pageShown('usage')).toBe(false);
    });

    it('appears with the billing entries once credits are enabled', () => {
      expect(entryIds('usage', { balanceEnabled: true })).toEqual(['tokenCredits', 'autoRefill']);
      expect(pageShown('usage', { balanceEnabled: true })).toBe(true);
    });
  });

  describe('notifications', () => {
    it('is hidden when every reply notification capability is off', () => {
      expect(
        pageShown('notifications', {
          replyTabBadgeAllowed: false,
          replyNotificationsAllowed: false,
          replyNotificationSoundAllowed: false,
        }),
      ).toBe(false);
    });

    it('shows the rows the deployment allows', () => {
      expect(
        entryIds('notifications', {
          replyTabBadgeAllowed: false,
          replyNotificationsAllowed: true,
          replyNotificationSoundAllowed: false,
        }),
      ).toEqual(['replyNotifications']);
    });
  });

  describe('voice', () => {
    it('shows the speech sections without any capability gate', () => {
      expect(entryIds('voice')).toEqual([
        'speechToText',
        'engineSTT',
        'languageSTT',
        'autoTranscribeAudio',
        'decibelValue',
        'autoSendText',
        'textToSpeech',
        'engineTTS',
        'voice',
        'conversationMode',
        'automaticPlayback',
        'cloudBrowserVoices',
        'playbackRate',
        'cacheTTS',
      ]);
      expect(pageShown('voice')).toBe(true);
    });
  });

  describe('security', () => {
    it('is hidden for a federated account with no security feature enabled', () => {
      expect(
        pageShown('security', {
          isLocalProvider: false,
          isTwoFactorPolicyProvider: false,
          passkeyLoginEnabled: false,
        }),
      ).toBe(false);
    });

    it('lists the security entries the account can use', () => {
      expect(
        entryIds('security', {
          isLocalProvider: false,
          isTwoFactorPolicyProvider: true,
          twoFactorEnabled: true,
          passkeyLoginEnabled: true,
        }),
      ).toEqual(['twoFactor', 'backupCodes', 'passkeys']);
    });
  });

  describe('code', () => {
    it('combines the composer behavior with the run behavior rows', () => {
      expect(entryIds('code')).toEqual([
        'duringRunDefaultAction',
        'showThinking',
        'autoExpandTools',
      ]);
    });

    it('adds the code execution section only with stateful sessions', () => {
      expect(entryIds('code', { hasStatefulCodeSessions: true })).toEqual([
        'duringRunDefaultAction',
        'showThinking',
        'autoExpandTools',
        'defaultStatefulWorkspace',
        'codeEnvironments',
      ]);
    });
  });

  describe('storage', () => {
    it('shows the file and cache rows for every account', () => {
      expect(entryIds('storage')).toEqual(['manageFiles', 'deleteCache']);
      expect(pageShown('storage')).toBe(true);
    });
  });

  describe('data controls', () => {
    it('groups the data rows and the API key rows', () => {
      expect(entryIds('dataControls')).toEqual([
        'importConversations',
        'sharedLinks',
        'archivedChats',
        'archiveAllChats',
        'revokeKeys',
        'clearChats',
        'deleteAccount',
      ]);
    });

    it('adds the provider and agent key rows only when configured', () => {
      expect(
        entryIds('dataControls', { hasUserProvidedEndpoints: true, hasRemoteAgents: true }),
      ).toEqual([
        'importConversations',
        'sharedLinks',
        'archivedChats',
        'archiveAllChats',
        'providerApiKeys',
        'agentApiKeys',
        'revokeKeys',
        'clearChats',
        'deleteAccount',
      ]);
    });

    it('drops the delete-account row when deletion is disabled', () => {
      expect(entryIds('dataControls', { allowAccountDeletion: false })).not.toContain(
        'deleteAccount',
      );
    });
  });

  describe('customize', () => {
    it('reads the prompt section and the memory row', () => {
      expect(entryIds('customize')).toEqual([
        'advancedPrompts',
        'alwaysMakeProd',
        'autoSendPrompts',
      ]);
      expect(entryIds('customize', { hasMemoryOptOut: true })).toContain('referenceSavedMemories');
    });
  });

  describe('integrations', () => {
    it('hides Langfuse and CyVox without connection access', () => {
      expect(pageShown('langfuse')).toBe(false);
      expect(pageShown('cyvox')).toBe(false);
    });

    it('shows each integration when the account can manage it', () => {
      expect(entryIds('langfuse', { langfuseConnectionAccess: true })).toEqual([
        'langfuseConnection',
      ]);
      expect(pageShown('langfuse', { langfuseConnectionAccess: true })).toBe(true);
      expect(entryIds('cyvox', { cyvoxConnectionAccess: true })).toEqual(['cyvoxConnection']);
      expect(pageShown('cyvox', { cyvoxConnectionAccess: true })).toBe(true);
    });
  });

  describe('about', () => {
    it('is hidden when build information is switched off', () => {
      expect(pageShown('about')).toBe(false);
    });

    it('appears with its single row when build information is on', () => {
      expect(entryIds('about', { aboutEnabled: true })).toEqual(['about']);
      expect(pageShown('about', { aboutEnabled: true })).toBe(true);
    });
  });

  describe('registry coverage', () => {
    /* Every capability on at once: the context the pages have to cover. */
    const fullyCapable = contextFor({
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
      langfuseConnectionAccess: true,
      cyvoxConnectionAccess: true,
      adminPanelURL: 'https://admin.example.com',
      replyTabBadgeAllowed: true,
      replyNotificationsAllowed: true,
      replyNotificationSoundAllowed: true,
    });

    it('shows every registry entry once every capability is on', () => {
      const hidden = registry.filter((entry) => entry.show && !entry.show(fullyCapable));
      expect(hidden.map((entry) => entry.id)).toEqual([]);
    });

    it('reaches every registry entry from some iOS page', () => {
      const reachable = new Set(
        IOS_PAGES.flatMap((page) => pageEntries(page, fullyCapable).map((entry) => entry.id)),
      );
      const unreachable = registry
        .filter((entry) => !reachable.has(entry.id))
        .map((entry) => entry.id);
      expect(unreachable).toEqual([]);
    });
  });

  it('keeps every page on the tabs the desktop dialog knows', () => {
    const knownTabs = new Set<string>(Object.values(SettingsTabValues));
    for (const page of IOS_PAGES) {
      for (const source of page.sources) {
        expect(knownTabs.has(source.tab)).toBe(true);
      }
    }
  });
});
