import { useId } from 'react';
import { useAtom } from 'jotai';
import { useNavigate } from 'react-router-dom';
import { Button, TooltipAnchor } from '@coderax/client';
import { ArrowUpRight, Check, Plus } from 'lucide-react';
import type { TaskbarApp, TaskbarCategory } from './registry';
import {
  TASKBAR_APPS,
  TASKBAR_CATEGORIES,
  TASKBAR_CATEGORY_LABELS,
  taskbarPinsAtom,
} from './registry';
import { PanelContent, PanelHeader } from '~/components/ui';
import { useLocalize } from '~/hooks';

export default function PluginsPanel() {
  const localize = useLocalize();
  const headingId = useId();
  const navigate = useNavigate();
  const [pinnedIds, setPinnedIds] = useAtom(taskbarPinsAtom);

  const togglePin = (id: string) => {
    setPinnedIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  };

  const open = (app: TaskbarApp) => {
    if (app.path != null) {
      navigate(app.path);
      return;
    }
    if (app.href != null) {
      window.open(app.href, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div
      role="region"
      aria-labelledby={headingId}
      className="flex h-full w-full flex-col overflow-hidden pt-2"
    >
      <PanelHeader title={localize('com_ui_plugins')} titleId={headingId} />
      <PanelContent isLoading={false} skeleton={null}>
        <p className="text-text-secondary mb-3 text-xs">
          {localize('com_ui_taskbar_plugins_description')}
        </p>
        {TASKBAR_CATEGORIES.map((category) => (
          <PluginsCategory
            key={category}
            category={category}
            pinnedIds={pinnedIds}
            onTogglePin={togglePin}
            onOpen={open}
          />
        ))}
        <p className="text-text-tertiary mt-3 text-xs">{localize('com_ui_taskbar_pin_hint')}</p>
      </PanelContent>
    </div>
  );
}

function PluginsCategory({
  category,
  pinnedIds,
  onTogglePin,
  onOpen,
}: {
  category: TaskbarCategory;
  pinnedIds: string[];
  onTogglePin: (id: string) => void;
  onOpen: (app: TaskbarApp) => void;
}) {
  const localize = useLocalize();
  const headingId = `plugins-${category}`;
  const apps = TASKBAR_APPS.filter((app) => app.category === category);

  return (
    <section className="mb-4" aria-labelledby={headingId}>
      <h3
        id={headingId}
        className="text-text-secondary mb-1 px-1 text-xs font-medium tracking-wide uppercase"
      >
        {localize(TASKBAR_CATEGORY_LABELS[category])}
      </h3>
      <ul className="m-0 list-none p-0">
        {apps.map((app) => {
          const pinned = pinnedIds.includes(app.id);
          return (
            <li key={app.id} className="hover:bg-surface-hover flex items-center gap-1 rounded-lg">
              <button
                type="button"
                onClick={() => onOpen(app)}
                className="focus-visible:ring-focus-control flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-1.5 text-left focus-visible:ring-2 focus-visible:outline-hidden"
              >
                <span className="bg-surface-secondary flex size-8 shrink-0 items-center justify-center rounded-lg">
                  <app.icon className="text-text-primary size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-text-primary block truncate text-sm">
                    {localize(app.label)}
                  </span>
                  <span className="text-text-tertiary block truncate text-xs">
                    {app.href != null
                      ? localize('com_ui_taskbar_external')
                      : localize(TASKBAR_CATEGORY_LABELS[app.category])}
                  </span>
                </span>
                {app.href != null && (
                  <ArrowUpRight
                    className="text-text-tertiary size-3.5 shrink-0"
                    aria-hidden="true"
                  />
                )}
              </button>
              <TooltipAnchor
                side="left"
                description={localize(pinned ? 'com_ui_taskbar_remove' : 'com_ui_taskbar_add')}
                render={
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-7 shrink-0"
                    aria-label={localize(pinned ? 'com_ui_taskbar_remove' : 'com_ui_taskbar_add')}
                    aria-pressed={pinned}
                    onClick={() => onTogglePin(app.id)}
                  >
                    {pinned ? (
                      <Check className="size-3.5" aria-hidden="true" />
                    ) : (
                      <Plus className="size-3.5" aria-hidden="true" />
                    )}
                  </Button>
                }
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
