import type { TWorkTasksResponse } from 'coderax-data-provider';

export function workTasksRefetchInterval(
  data: TWorkTasksResponse | undefined,
  activeJobIds: readonly string[] | undefined,
): number {
  return (activeJobIds?.length ?? 0) > 0 ||
    data?.tasks.some((task) => task.state === 'running' || task.state === 'awaiting_approval')
    ? 5_000
    : 60_000;
}
