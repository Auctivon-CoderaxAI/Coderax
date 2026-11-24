import { memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSetAtom } from 'jotai';
import { Compass, FolderKanban, SlidersHorizontal, Sparkles } from 'lucide-react';
import { SettingsTabValues } from 'coderax-data-provider';
import { settingsOpenAtom, settingsTabAtom } from '~/components/Nav/Settings';
import { useLocalize } from '~/hooks';
import type { TranslationKeys } from '~/hooks';

interface QuickLink {
  id: string;
  labelKey: TranslationKeys;
  icon: typeof Compass;
  onSelect: () => void;
}

/**
 * The drawer's shortcut block: the handful of destinations that are about the
 * app rather than about one conversation. Rows, not glyphs, so each one is
 * labelled at thumb size instead of relying on an icon legend.
 */
function QuickLinks({ onNavigate }: { onNavigate: () => void }) {
  const localize = useLocalize();
  const navigate = useNavigate();
  const setSettingsOpen = useSetAtom(settingsOpenAtom);
  const setSettingsTab = useSetAtom(settingsTabAtom);

  const links: QuickLink[] = [
    {
      id: 'projects',
      labelKey: 'com_ui_projects',
      icon: FolderKanban,
      onSelect: () => navigate('/projects'),
    },
    {
      id: 'skills',
      labelKey: 'com_ui_skills',
      icon: Sparkles,
      onSelect: () => navigate('/skills'),
    },
    {
      id: 'explore',
      labelKey: 'com_ui_explore',
      icon: Compass,
      onSelect: () => navigate('/agents'),
    },
    {
      id: 'customize',
      labelKey: 'com_ui_settings_ios_customize',
      icon: SlidersHorizontal,
      onSelect: () => {
        setSettingsTab(SettingsTabValues.DATA);
        setSettingsOpen(true);
      },
    },
  ];

  return (
    <div className="flex shrink-0 flex-col gap-0.5 px-2 pt-2 pb-1">
      {links.map((link) => (
        <button
          key={link.id}
          type="button"
          data-testid={`drawer-quick-${link.id}`}
          onClick={() => {
            onNavigate();
            link.onSelect();
          }}
          className="text-text-primary hover:bg-surface-hover focus-visible:ring-border-xheavy flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-left text-base transition-colors focus-visible:ring-2 focus-visible:outline-hidden focus-visible:ring-inset"
        >
          <link.icon className="text-text-primary size-5 shrink-0" aria-hidden="true" />
          <span className="truncate">{localize(link.labelKey)}</span>
        </button>
      ))}
    </div>
  );
}

export default memo(QuickLinks);
