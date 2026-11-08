import { useCallback, useEffect, useMemo, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { dataService, QueryKeys } from 'coderax-data-provider';
import { buttonVariants, cn, useToastContext } from '@coderax/client';
import type { TWorkTasksResponse } from 'coderax-data-provider';
import {
  useActiveJobs,
  useGetPinnedOrderQuery,
  useUpdatePinnedOrderMutation,
} from '~/data-provider';
import WorkTaskRow, { workTaskPinKey } from './WorkTaskRow';
import { useLocalize, useLocalStorage } from '~/hooks';
import { NotificationSeverity } from '~/common';
import { Collapse } from '~/components/ui';
import { workTasksRefetchInterval } from './polling';

type WorkTasksSectionProps = {
  isAuthenticated: boolean;
  toggleNav: (afterSlide?: () => void) => void;
};

const MAX_RECENT_WORK_TASKS = 12;

export default function WorkTasksSection({ isAuthenticated, toggleNav }: WorkTasksSectionProps) {
  const localize = useLocalize();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: activeJobs } = useActiveJobs(isAuthenticated);
  const activeJobIds = activeJobs?.activeJobIds;
  const activeJobKey = activeJobIds ? JSON.stringify([...activeJobIds].sort()) : undefined;
  const previousActiveJobKey = useRef<string | undefined>();
  const [isExpanded, setIsExpanded] = useLocalStorage('workTasksExpanded', true);
  const { showToast } = useToastContext();
  const tasksQuery = useQuery<TWorkTasksResponse>({
    queryKey: [QueryKeys.workTasks],
    queryFn: ({ signal }) => dataService.getWorkTasks(signal),
    enabled: isAuthenticated,
    retry: false,
    staleTime: 5_000,
    refetchInterval: (data) => workTasksRefetchInterval(data, activeJobIds),
    refetchIntervalInBackground: false,
  });
  useEffect(() => {
    if (activeJobKey === undefined) {
      return;
    }
    if (previousActiveJobKey.current !== undefined && previousActiveJobKey.current !== activeJobKey) {
      void queryClient.invalidateQueries([QueryKeys.workTasks]);
    }
    previousActiveJobKey.current = activeJobKey;
  }, [activeJobKey, queryClient]);
  const {
    data: pinnedOrder,
    isSuccess: isOrderFetched,
    isFetching: isOrderFetching,
  } = useGetPinnedOrderQuery({ enabled: isAuthenticated });
  const orderLoaded = isOrderFetched && !isOrderFetching;
  const updatePinnedOrder = useUpdatePinnedOrderMutation();
  const pinnedWorkKeys = useMemo(
    () => new Set((pinnedOrder ?? []).filter((key) => key.startsWith('work:'))),
    [pinnedOrder],
  );
  const recentTasks = useMemo(
    () =>
      (tasksQuery.data?.tasks ?? [])
        .filter((task) => !pinnedWorkKeys.has(workTaskPinKey(task.id)))
        .slice(0, MAX_RECENT_WORK_TASKS),
    [tasksQuery.data?.tasks, pinnedWorkKeys],
  );

  const pinTask = useCallback(
    (conversationId: string) => {
      if (!orderLoaded || updatePinnedOrder.isLoading) {
        return;
      }
      const key = workTaskPinKey(conversationId);
      const current = pinnedOrder ?? [];
      if (current.includes(key)) {
        return;
      }
      updatePinnedOrder.mutate([...current, key], {
        onError: () =>
          showToast({
            message: localize('com_ui_pin_error'),
            severity: NotificationSeverity.ERROR,
            showIcon: true,
          }),
      });
    },
    [localize, orderLoaded, pinnedOrder, showToast, updatePinnedOrder],
  );

  if (
    !isAuthenticated ||
    (!tasksQuery.isLoading && !tasksQuery.isError && recentTasks.length === 0)
  ) {
    return null;
  }

  return (
    <section className="flex flex-col px-3 pt-3 text-sm" aria-label={localize('com_ui_work')}>
      <div className="flex h-8 w-full items-center pr-1">
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className={cn(buttonVariants({ variant: 'section-header' }), 'group min-w-0 flex-1')}
          aria-expanded={isExpanded}
        >
          <span className="truncate select-none">{localize('com_ui_work')}</span>
          <ChevronDown
            className={cn(
              'h-3 w-3 shrink-0 transition-transform duration-200',
              isExpanded ? '' : '-rotate-90',
            )}
            aria-hidden="true"
          />
        </button>
      </div>
      <Collapse open={isExpanded}>
        <div className="pt-0.5">
          {tasksQuery.isLoading && (
            <p role="status" className="text-text-secondary px-2 py-2 text-xs">
              {localize('com_work_history_loading')}
            </p>
          )}
          {tasksQuery.isError && (
            <p role="alert" className="text-text-secondary px-2 py-2 text-xs">
              {localize('com_work_tasks_unavailable')}
            </p>
          )}
          {!tasksQuery.isError && recentTasks.length > 0 && (
            <ul className="m-0 list-none space-y-0.5 p-0">
              {recentTasks.map((task) => (
                <li key={task.id}>
                  <WorkTaskRow
                    task={task}
                    pinned={false}
                    onSelect={() =>
                      toggleNav(() => navigate(`/work/${encodeURIComponent(task.id)}`))
                    }
                    onTogglePin={() => pinTask(task.id)}
                    pinDisabled={!orderLoaded || updatePinnedOrder.isLoading}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </Collapse>
    </section>
  );
}
