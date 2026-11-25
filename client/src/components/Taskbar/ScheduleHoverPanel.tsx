import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as Ariakit from '@ariakit/react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, TooltipAnchor, useToastContext } from '@coderax/client';
import { isCronCadence, PermissionTypes, Permissions } from 'coderax-data-provider';
import { Check, ChevronRight, ListFilter, Play, Plus, Search, X } from 'lucide-react';
import type { ScheduleFrequency, TSchedule } from 'coderax-data-provider';
import type { LocalizeFunction } from '~/common';
import type { TranslationKeys } from '~/hooks';
import ScheduleCardSkeleton from '~/components/SidePanel/Schedules/ScheduleCardSkeleton';
import ScheduleEmptyState from '~/components/SidePanel/Schedules/ScheduleEmptyState';
import { useSchedulesQuery, useUpdateScheduleMutation } from '~/data-provider';
import ScheduleDialog from '~/components/SidePanel/Schedules/ScheduleDialog';
import { useClockFormat, useHasAccess, useLocalize } from '~/hooks';
import { cn } from '~/utils';

type ScheduleFilter = 'all' | 'active' | 'paused';

const FILTER_OPTIONS: ReadonlyArray<{ value: ScheduleFilter; label: TranslationKeys }> = [
  { value: 'all', label: 'com_ui_taskbar_all' },
  { value: 'active', label: 'com_ui_taskbar_active' },
  { value: 'paused', label: 'com_ui_schedule_paused' },
];

const CADENCE_LABEL_KEYS: Record<ScheduleFrequency, TranslationKeys> = {
  hourly: 'com_ui_schedule_hourly',
  daily: 'com_ui_schedule_daily',
  weekdays: 'com_ui_schedule_weekdays',
  weekly: 'com_ui_schedule_weekly',
  cron: 'com_ui_schedule_cron',
};

function statusDotClass(isActive: boolean, disabledReason: TSchedule['disabledReason']): string {
  if (isActive) {
    return 'bg-status-info';
  }
  if (disabledReason != null) {
    return 'bg-status-warning';
  }
  return 'border-border-heavy border';
}

/** The card's next-run line, in the compact form the hover drawer uses: the day
 *  is spoken only when it is not today, so the common case reads "Today 1:10 PM". */
function formatNextRun(
  value: string | undefined,
  locale: string | undefined,
  hour12: boolean | undefined,
  localize: LocalizeFunction,
): string | null {
  if (value == null) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const now = new Date();
  const startOfDay = (input: Date) =>
    new Date(input.getFullYear(), input.getMonth(), input.getDate());
  const dayDiff = Math.round((startOfDay(date).getTime() - startOfDay(now).getTime()) / 86_400_000);
  const time = new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    hour12,
  }).format(date);
  if (dayDiff === 0) {
    return `${localize('com_ui_taskbar_today')} ${time}`;
  }
  if (dayDiff === 1) {
    return `${localize('com_ui_taskbar_tomorrow')} ${time}`;
  }
  if (dayDiff > 1 && dayDiff < 7) {
    const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date);
    return `${weekday} ${time}`;
  }
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12,
  }).format(date);
}

interface ScheduleHoverRowProps {
  schedule: TSchedule;
  localize: LocalizeFunction;
  locale?: string;
  hour12?: boolean;
  canWrite: boolean;
  isUpdating: boolean;
  onOpen: (schedule: TSchedule) => void;
  onToggle: (schedule: TSchedule) => void;
}

function ScheduleHoverRow({
  schedule,
  localize,
  locale,
  hour12,
  canWrite,
  isUpdating,
  onOpen,
  onToggle,
}: ScheduleHoverRowProps) {
  const isActive = schedule.enabled && schedule.disabledReason == null;
  const nextRun = isActive ? formatNextRun(schedule.nextRunAt, locale, hour12, localize) : null;
  const cadence = localize(
    isCronCadence(schedule.cadence)
      ? 'com_ui_schedule_cron'
      : CADENCE_LABEL_KEYS[schedule.cadence.frequency],
  );
  const detail = [nextRun, cadence].filter(Boolean).join(' · ');
  const canToggle = canWrite && schedule.disabledReason == null;
  const actionLabel = isActive ? 'com_ui_taskbar_pause' : 'com_ui_taskbar_resume';

  return (
    <div
      data-testid="schedule-hover-row"
      className="group hover:bg-surface-hover flex items-start gap-2 rounded-lg px-3 py-2"
    >
      <button
        type="button"
        onClick={() => onOpen(schedule)}
        className="focus-visible:ring-text-primary min-w-0 flex-1 rounded-sm text-left focus-visible:ring-2 focus-visible:outline-hidden"
      >
        <span className="text-text-primary block truncate text-sm font-medium">
          {schedule.name}
        </span>
        <span className="text-text-secondary mt-0.5 block truncate text-xs" title={detail}>
          {detail}
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-1">
        {canToggle && (
          <TooltipAnchor
            side="right"
            description={localize(actionLabel)}
            render={
              <button
                type="button"
                aria-label={localize(actionLabel)}
                disabled={isUpdating}
                onClick={() => onToggle(schedule)}
                className="text-text-secondary hover:bg-surface-active-alt hover:text-text-primary focus-visible:ring-text-primary flex size-6 items-center justify-center rounded-md opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-hidden disabled:opacity-50"
              >
                {isActive ? (
                  <X className="size-3.5" aria-hidden="true" />
                ) : (
                  <Play className="size-3.5" aria-hidden="true" />
                )}
              </button>
            }
          />
        )}
        <span
          aria-hidden="true"
          className={cn(
            'mt-1.5 size-2 shrink-0 rounded-full',
            statusDotClass(isActive, schedule.disabledReason),
          )}
        />
      </div>
    </div>
  );
}

export default function ScheduleHoverPanel({ onClose }: { onClose: () => void }) {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const { showToast } = useToastContext();
  const hour12 = useClockFormat();
  const { data, isLoading, isError, refetch } = useSchedulesQuery();
  const schedules = useMemo(() => data?.schedules ?? [], [data]);
  const canCreate = useHasAccess({
    permissionType: PermissionTypes.SCHEDULES,
    permission: Permissions.CREATE,
  });
  const updateSchedule = useUpdateScheduleMutation();
  const [filter, setFilter] = useState<ScheduleFilter>('all');
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pausedOpen, setPausedOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TSchedule | undefined>();
  const searchRef = useRef<HTMLInputElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !dialogOpen) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [dialogOpen, onClose]);

  const cancelClose = useCallback(() => {
    if (closeTimer.current != null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    if (dialogOpen || filterMenuOpen || searchRef.current === document.activeElement) {
      return;
    }
    cancelClose();
    closeTimer.current = setTimeout(onClose, 160);
  }, [cancelClose, dialogOpen, filterMenuOpen, onClose]);

  useEffect(() => () => cancelClose(), [cancelClose]);

  const openNewTask = useCallback(() => {
    setEditing(undefined);
    setDialogOpen(true);
  }, []);

  const openSchedule = useCallback(
    (schedule: TSchedule) => {
      const conversationId =
        schedule.lastRun?.conversationId ?? schedule.inFlight?.[0]?.conversationId;
      if (conversationId != null && conversationId !== '') {
        onClose();
        navigate(`/c/${conversationId}`);
        return;
      }
      if (canCreate) {
        setEditing(schedule);
        setDialogOpen(true);
      }
    },
    [canCreate, navigate, onClose],
  );

  const toggleSchedule = useCallback(
    (schedule: TSchedule) => {
      const enabled = !schedule.enabled;
      updateSchedule.mutate(
        { id: schedule.id, payload: { enabled } },
        {
          onSuccess: () => {
            showToast({
              message: localize(enabled ? 'com_ui_schedule_enabled' : 'com_ui_schedule_paused'),
              status: 'success',
            });
          },
          onError: () => {
            showToast({ message: localize('com_ui_error'), status: 'error' });
          },
        },
      );
    },
    [localize, showToast, updateSchedule],
  );

  const handleDialogOpenChange = useCallback((open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      setEditing(undefined);
    }
  }, []);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const activeSchedules = useMemo(
    () =>
      schedules.filter((schedule) => {
        if (!schedule.enabled || schedule.disabledReason != null) {
          return false;
        }
        if (normalizedQuery === '') {
          return true;
        }
        return `${schedule.name} ${schedule.prompt}`.toLocaleLowerCase().includes(normalizedQuery);
      }),
    [normalizedQuery, schedules],
  );
  const pausedSchedules = useMemo(
    () =>
      schedules.filter((schedule) => {
        if (schedule.enabled && schedule.disabledReason == null) {
          return false;
        }
        if (normalizedQuery === '') {
          return true;
        }
        return `${schedule.name} ${schedule.prompt}`.toLocaleLowerCase().includes(normalizedQuery);
      }),
    [normalizedQuery, schedules],
  );

  const showActive = filter !== 'paused';
  const showPaused = filter !== 'active';
  const noMatches = activeSchedules.length === 0 && pausedSchedules.length === 0;

  return createPortal(
    <>
      <div
        aria-hidden="true"
        data-testid="schedule-hover-backdrop"
        className="fixed inset-y-0 right-0 left-16 z-[80] bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label={localize('com_ui_taskbar_scheduled')}
        data-testid="schedule-hover-panel"
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
        className="border-border-light bg-surface-secondary fixed inset-y-0 left-16 z-[81] flex w-[310px] max-w-[calc(100vw-5rem)] flex-col border-r shadow-2xl"
      >
        <div className="flex items-center justify-between px-4 pt-4">
          <h2 className="text-text-primary text-lg font-semibold">
            {localize('com_ui_taskbar_scheduled')}
          </h2>
          <div className="flex items-center gap-1">
            <Ariakit.MenuProvider
              placement="bottom-end"
              open={filterMenuOpen}
              setOpen={setFilterMenuOpen}
            >
              <Ariakit.MenuButton
                aria-label={localize('com_ui_taskbar_filter')}
                className="text-text-secondary hover:bg-surface-hover hover:text-text-primary focus-visible:ring-focus-control flex size-7 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-hidden"
              >
                <ListFilter className="size-4" aria-hidden="true" />
              </Ariakit.MenuButton>
              <Ariakit.Menu
                portal
                gutter={4}
                unmountOnHide
                className="border-border-menu bg-surface-menu rounded-theme-menu-panel z-[90] min-w-[10rem] border p-1 shadow-lg outline-hidden"
              >
                {FILTER_OPTIONS.map((option) => (
                  <Ariakit.MenuItem
                    key={option.value}
                    role="menuitemradio"
                    aria-checked={filter === option.value}
                    onClick={() => setFilter(option.value)}
                    className="text-text-secondary data-[active-item]:bg-surface-hover data-[active-item]:text-text-primary flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm"
                  >
                    <span className="flex-1">{localize(option.label)}</span>
                    {filter === option.value && (
                      <Check className="text-text-primary size-4 shrink-0" aria-hidden="true" />
                    )}
                  </Ariakit.MenuItem>
                ))}
              </Ariakit.Menu>
            </Ariakit.MenuProvider>
            <Button
              size="icon"
              variant="ghost"
              aria-label={localize('com_ui_taskbar_search')}
              onClick={() => searchRef.current?.focus()}
            >
              <Search className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>

        <div className="border-border-light mt-2 flex items-center border-b px-4">
          <span className="border-text-primary text-text-primary border-b-2 px-1 pb-1.5 text-sm font-medium">
            {localize('com_ui_taskbar_all')}
          </span>
        </div>

        {canCreate && (
          <button
            type="button"
            onClick={openNewTask}
            className="text-text-primary hover:bg-surface-hover flex w-full items-center gap-2 px-4 py-2 text-sm transition-colors"
          >
            <Plus className="size-4" aria-hidden="true" />
            {localize('com_ui_taskbar_new_task')}
          </button>
        )}

        <div className="flex items-center justify-between gap-2 px-4 pt-3">
          <h3 className="text-text-primary text-sm font-medium">
            {localize(filter === 'paused' ? 'com_ui_schedule_paused' : 'com_ui_taskbar_active')}
          </h3>
          <label className="text-text-secondary flex min-w-0 items-center gap-1">
            <Search className="size-3.5 shrink-0" aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={localize('com_ui_taskbar_search')}
              aria-label={localize('com_ui_taskbar_search')}
              className="text-text-primary placeholder:text-text-secondary focus-visible:ring-text-primary h-6 w-[110px] min-w-0 rounded-sm border-0 bg-transparent p-0 text-xs focus-visible:ring-2 focus-visible:outline-hidden"
            />
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-2 pb-6">
          {isLoading && <ScheduleCardSkeleton count={4} />}
          {!isLoading && isError && <ScheduleEmptyState isError onRetry={() => refetch()} />}
          {!isLoading && !isError && schedules.length === 0 && (
            <ScheduleEmptyState canCreate={canCreate} />
          )}
          {!isLoading && !isError && schedules.length > 0 && (
            <>
              {showActive &&
                activeSchedules.length > 0 &&
                activeSchedules.map((schedule) => (
                  <ScheduleHoverRow
                    key={schedule.id}
                    schedule={schedule}
                    localize={localize}
                    locale={i18n.language}
                    hour12={hour12}
                    canWrite={canCreate}
                    isUpdating={Boolean(updateSchedule.isLoading)}
                    onOpen={openSchedule}
                    onToggle={toggleSchedule}
                  />
                ))}
              {showActive && activeSchedules.length === 0 && filter === 'active' && (
                <p className="text-text-secondary px-2 py-3 text-xs">
                  {localize('com_ui_no_schedules_match')}
                </p>
              )}
              {showPaused &&
                filter === 'paused' &&
                pausedSchedules.map((schedule) => (
                  <ScheduleHoverRow
                    key={schedule.id}
                    schedule={schedule}
                    localize={localize}
                    locale={i18n.language}
                    hour12={hour12}
                    canWrite={canCreate}
                    isUpdating={Boolean(updateSchedule.isLoading)}
                    onOpen={openSchedule}
                    onToggle={toggleSchedule}
                  />
                ))}
              {showPaused && filter !== 'paused' && pausedSchedules.length > 0 && (
                <>
                  <button
                    type="button"
                    aria-expanded={pausedOpen}
                    onClick={() => setPausedOpen((current) => !current)}
                    className="text-text-secondary hover:text-text-primary mt-2 flex w-full items-center gap-1 px-2 py-2 text-sm font-medium transition-colors"
                  >
                    <ChevronRight
                      className={cn('size-4 transition-transform', pausedOpen && 'rotate-90')}
                      aria-hidden="true"
                    />
                    {localize('com_ui_schedule_paused')}
                  </button>
                  {pausedOpen &&
                    pausedSchedules.map((schedule) => (
                      <ScheduleHoverRow
                        key={schedule.id}
                        schedule={schedule}
                        localize={localize}
                        locale={i18n.language}
                        hour12={hour12}
                        canWrite={canCreate}
                        isUpdating={Boolean(updateSchedule.isLoading)}
                        onOpen={openSchedule}
                        onToggle={toggleSchedule}
                      />
                    ))}
                </>
              )}
              {filter === 'all' && noMatches && (
                <p className="text-text-secondary px-2 py-3 text-xs">
                  {localize('com_ui_no_schedules_match')}
                </p>
              )}
              {filter === 'paused' && pausedSchedules.length === 0 && (
                <p className="text-text-secondary px-2 py-3 text-xs">
                  {localize('com_ui_no_schedules_match')}
                </p>
              )}
            </>
          )}
        </div>

        <ScheduleDialog
          open={dialogOpen}
          onOpenChange={handleDialogOpenChange}
          schedule={editing}
        />
      </div>
    </>,
    document.body,
  );
}
