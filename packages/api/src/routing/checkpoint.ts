/**
 * Where a Work run may change the model behind it.
 *
 * A switch is safe only before a turn starts or between completed tool calls.
 * While tokens are streaming, a tool is executing, or an approval is pending,
 * the run already owns partial work — switching there could repeat a side
 * effect that was never recorded, so failover refuses instead.
 */

export const WORK_CHECKPOINTS = [
  'turn_start',
  'between_tool_calls',
  'streaming',
  'tool_running',
  'awaiting_approval',
] as const;

export type WorkCheckpoint = (typeof WORK_CHECKPOINTS)[number];

export function isSafeModelSwitchPoint(checkpoint: WorkCheckpoint): boolean {
  return checkpoint === 'turn_start' || checkpoint === 'between_tool_calls';
}
