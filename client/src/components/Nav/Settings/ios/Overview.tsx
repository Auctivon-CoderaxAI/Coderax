import { LogOut } from 'lucide-react';
import { Avatar } from '@coderax/client';
import type { IosPageId } from './pages';
import type { SettingsContextValue } from '../types';
import { IOS_PAGES, pageVisible } from './pages';
import { useAuthContext, useLocalize } from '~/hooks';
import { Group, NavRow } from './Rows';

const ACCOUNT_PAGE: IosPageId = 'account';
const CUSTOMIZE_PAGE: IosPageId = 'customize';
const ABOUT_PAGE: IosPageId = 'about';

/** Pages in the main group, in the order the iOS app lists them. */
const MAIN_PAGES: IosPageId[] = [
  'general',
  'chat',
  'usage',
  'notifications',
  'voice',
  'security',
  'code',
  'storage',
  'dataControls',
  'langfuse',
  'cyvox',
];

export default function Overview({
  ctx,
  onOpen,
  onClose,
  onQueryChange,
}: {
  ctx: SettingsContextValue;
  onOpen: (page: IosPageId) => void;
  onClose: () => void;
  onQueryChange: (query: string) => void;
}) {
  const localize = useLocalize();
  const { user, logout } = useAuthContext();

  const visiblePages = IOS_PAGES.filter((page) => pageVisible(page, ctx));
  const pageById = (id: IosPageId) => visiblePages.find((page) => page.id === id);
  const accountPage = pageById(ACCOUNT_PAGE);
  const customizePage = pageById(CUSTOMIZE_PAGE);
  const aboutPage = pageById(ABOUT_PAGE);

  const open = (id: IosPageId) => {
    onQueryChange('');
    onOpen(id);
  };

  const displayName = user?.name ?? user?.username;

  return (
    <div className="flex flex-col gap-4 pb-6">
      {accountPage != null && (
        <Group>
          <NavRow
            label={localize(accountPage.labelKey)}
            icon={accountPage.icon}
            value={
              <span className="flex items-center gap-2">
                {displayName != null && displayName !== '' && (
                  <span className="text-text-secondary max-w-40 truncate">{displayName}</span>
                )}
                {user != null && <Avatar user={user} size={24} />}
              </span>
            }
            onClick={() => open(ACCOUNT_PAGE)}
            testId="ios-settings-account"
          />
        </Group>
      )}

      {customizePage != null && (
        <Group>
          <NavRow
            label={localize(customizePage.labelKey)}
            description={
              customizePage.descriptionKey != null
                ? localize(customizePage.descriptionKey)
                : undefined
            }
            icon={customizePage.icon}
            onClick={() => open(CUSTOMIZE_PAGE)}
            testId="ios-settings-customize"
          />
        </Group>
      )}

      <Group>
        {MAIN_PAGES.map((id) => {
          const page = pageById(id);
          if (page == null) {
            return null;
          }
          return (
            <NavRow
              key={id}
              label={localize(page.labelKey)}
              icon={page.icon}
              onClick={() => open(id)}
              testId={`ios-settings-${id}`}
            />
          );
        })}
      </Group>

      {aboutPage != null && (
        <Group>
          <NavRow
            label={localize(aboutPage.labelKey)}
            icon={aboutPage.icon}
            onClick={() => open(ABOUT_PAGE)}
            testId="ios-settings-about"
          />
        </Group>
      )}

      {user != null && (
        <Group>
          <button
            type="button"
            onClick={() => {
              onClose();
              logout();
            }}
            className="hover:bg-surface-hover focus-visible:ring-border-xheavy text-text-destructive flex min-h-12 w-full items-center gap-3 px-4 py-3 text-left text-base transition-colors focus-visible:ring-2 focus-visible:outline-hidden focus-visible:ring-inset"
          >
            <LogOut className="size-5 shrink-0" aria-hidden="true" />
            {localize('com_nav_log_out')}
          </button>
        </Group>
      )}
    </div>
  );
}
