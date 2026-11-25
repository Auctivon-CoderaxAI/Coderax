import { useMemo } from 'react';
import { useAtom } from 'jotai';
import * as Ariakit from '@ariakit/react';
import { Check, Ellipsis, Plus } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { TooltipAnchor, buttonVariants } from '@coderax/client';
import type { TaskbarApp } from './registry';
import { TASKBAR_APP_BY_ID, TASKBAR_APPS, taskbarPinsAtom } from './registry';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

function isActive(pathname: string, app: TaskbarApp): boolean {
  return app.path != null && (pathname === app.path || pathname.startsWith(`${app.path}/`));
}

export default function Taskbar() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [pinnedIds, setPinnedIds] = useAtom(taskbarPinsAtom);

  const pinned = useMemo(
    () =>
      pinnedIds
        .map((id) => TASKBAR_APP_BY_ID.get(id))
        .filter((app): app is TaskbarApp => app != null),
    [pinnedIds],
  );

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
    <div className="border-border-light mt-1 flex w-full flex-col items-center gap-1 border-t pt-1">
      {pinned.map((app) => (
        <TooltipAnchor
          key={app.id}
          side="right"
          description={localize(app.label)}
          render={
            <button
              type="button"
              aria-label={localize(app.label)}
              aria-pressed={isActive(pathname, app)}
              data-testid={`nav-taskbar-${app.id}`}
              className={cn(
                buttonVariants({ variant: 'ghost', size: 'icon' }),
                'h-9 w-9 rounded-lg',
                isActive(pathname, app)
                  ? 'bg-surface-active-alt text-text-primary'
                  : 'text-text-secondary',
              )}
              onClick={() => open(app)}
            >
              <app.icon className="h-5 w-5" aria-hidden="true" />
            </button>
          }
        />
      ))}
      <MoreMenu pinnedIds={pinnedIds} onToggle={togglePin} />
    </div>
  );
}

function MoreMenu({
  pinnedIds,
  onToggle,
}: {
  pinnedIds: string[];
  onToggle: (id: string) => void;
}) {
  const localize = useLocalize();

  return (
    <Ariakit.MenuProvider placement="right-start">
      <Ariakit.MenuButton
        aria-label={localize('com_ui_taskbar_more')}
        data-testid="nav-taskbar-more"
        className="text-text-secondary hover:bg-surface-hover hover:text-text-primary focus-visible:ring-focus-control flex h-9 w-9 items-center justify-center rounded-lg transition-colors focus-visible:ring-2 focus-visible:outline-hidden"
      >
        <Ellipsis className="h-5 w-5" aria-hidden="true" />
      </Ariakit.MenuButton>
      <Ariakit.Menu
        portal
        gutter={8}
        unmountOnHide
        className="border-border-menu bg-surface-menu rounded-theme-menu-panel z-50 min-w-[14rem] border p-1 shadow-lg outline-hidden"
      >
        <div className="text-text-secondary px-2 py-1 text-xs font-medium">
          {localize('com_ui_taskbar_add')}
        </div>
        {TASKBAR_APPS.map((app) => {
          const isPinned = pinnedIds.includes(app.id);
          return (
            <Ariakit.MenuItem
              key={app.id}
              hideOnClick={false}
              role="menuitemcheckbox"
              aria-checked={isPinned}
              onClick={() => onToggle(app.id)}
              className="text-text-secondary data-[active-item]:bg-surface-hover data-[active-item]:text-text-primary flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm"
            >
              <app.icon className="size-4 shrink-0" aria-hidden="true" />
              <span className="flex-1 truncate">{localize(app.label)}</span>
              {isPinned ? (
                <Check className="text-text-primary size-4 shrink-0" aria-hidden="true" />
              ) : (
                <Plus className="text-text-secondary size-4 shrink-0" aria-hidden="true" />
              )}
            </Ariakit.MenuItem>
          );
        })}
      </Ariakit.Menu>
    </Ariakit.MenuProvider>
  );
}
