import { useState } from 'react';
import * as Ariakit from '@ariakit/react';
import { TooltipAnchor, usePopoverZIndex } from '@coderax/client';
import { Permissions, PermissionTypes } from 'coderax-data-provider';
import {
  CalendarClock,
  CalendarDays,
  CalendarRange,
  Clock,
  Repeat,
  SlidersHorizontal,
} from 'lucide-react';
import type { ScheduleFrequency } from 'coderax-data-provider';
import type { LucideIcon } from 'lucide-react';
import type { TranslationKeys } from '~/hooks';
import type { NavLink } from '~/common';
import ScheduleDialog from '~/components/SidePanel/Schedules/ScheduleDialog';
import { useHasAccess, useLocalize } from '~/hooks';
import { cn } from '~/utils';

const FREQUENCY_OPTIONS: ReadonlyArray<{
  value: ScheduleFrequency;
  label: TranslationKeys;
  icon: LucideIcon;
}> = [
  { value: 'hourly', label: 'com_ui_schedule_hourly', icon: Clock },
  { value: 'daily', label: 'com_ui_schedule_daily', icon: CalendarDays },
  { value: 'weekdays', label: 'com_ui_schedule_weekdays', icon: CalendarRange },
  { value: 'weekly', label: 'com_ui_schedule_weekly', icon: Repeat },
  { value: 'cron', label: 'com_ui_schedule_cron', icon: SlidersHorizontal },
];

interface ScheduleNavButtonProps {
  link: NavLink;
  isActive: boolean;
  expanded: boolean;
  setActive: (id: string) => void;
  onExpand?: () => void;
  onLeaveInsights?: () => void;
  onHover?: () => void;
  onHoverEnd?: () => void;
  onDismissHover?: () => void;
}

export default function ScheduleNavButton({
  link,
  isActive,
  expanded,
  setActive,
  onExpand,
  onLeaveInsights,
  onHover,
  onHoverEnd,
  onDismissHover,
}: ScheduleNavButtonProps) {
  const localize = useLocalize();
  const zIndex = usePopoverZIndex();
  const canCreate = useHasAccess({
    permissionType: PermissionTypes.SCHEDULES,
    permission: Permissions.CREATE,
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialogFrequency, setDialogFrequency] = useState<ScheduleFrequency | null>(null);

  const handleClick = () => {
    onDismissHover?.();
    if (!isActive) {
      setActive(link.id);
    }
    if (!expanded) {
      onExpand?.();
    } else if (!isActive) {
      onLeaveInsights?.();
    }
  };

  return (
    <Ariakit.MenuProvider
      open={canCreate && menuOpen}
      setOpen={(open) => setMenuOpen(canCreate && open)}
      placement="right-start"
    >
      <TooltipAnchor
        side="right"
        description={localize(link.title)}
        render={
          <Ariakit.MenuButton
            aria-label={localize(link.title)}
            aria-pressed={isActive}
            aria-haspopup="menu"
            aria-expanded={canCreate && menuOpen}
            data-testid={`nav-panel-${link.id}`}
            className={cn(
              'h-9 w-9 rounded-lg',
              isActive ? 'bg-surface-active-alt text-text-primary' : 'text-text-secondary',
            )}
            onClick={handleClick}
            onMouseEnter={menuOpen ? undefined : onHover}
            onMouseLeave={onHoverEnd}
          >
            <link.icon className="h-5 w-5" aria-hidden="true" />
          </Ariakit.MenuButton>
        }
      />
      <Ariakit.Menu
        portal
        gutter={8}
        unmountOnHide
        aria-label={localize('com_ui_schedule_new')}
        className="popover-ui pointer-events-auto min-w-56"
        style={{ zIndex }}
      >
        <div className="text-text-secondary flex items-center gap-2 px-2 pt-1 pb-1.5 text-xs font-medium">
          <CalendarClock className="size-4 shrink-0" aria-hidden="true" />
          <span>{localize('com_ui_schedule_new')}</span>
        </div>
        {FREQUENCY_OPTIONS.map((option) => (
          <Ariakit.MenuItem
            key={option.value}
            onClick={() => {
              setMenuOpen(false);
              setDialogFrequency(option.value);
            }}
            className="text-text-primary data-[active-item]:bg-surface-hover flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm outline-hidden"
          >
            <option.icon className="text-text-secondary size-4 shrink-0" aria-hidden="true" />
            <span className="flex-1">{localize(option.label)}</span>
          </Ariakit.MenuItem>
        ))}
      </Ariakit.Menu>
      {dialogFrequency != null && (
        <ScheduleDialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setDialogFrequency(null);
            }
          }}
          initialFrequency={dialogFrequency}
        />
      )}
    </Ariakit.MenuProvider>
  );
}
