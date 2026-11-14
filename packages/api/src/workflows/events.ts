import { WORKFLOW_RUN_INPUT_MAX_LENGTH } from 'coderax-data-provider';
import type { WorkflowEventTrigger } from 'coderax-data-provider';
import type { JsonValue } from '../agents/json';

/** One authenticated agent event as the durable delivery lane accepted it. */
export interface WorkflowAgentEvent {
  userId: string;
  tenantId?: string;
  eventId: string;
  eventType: string;
  sourceId: string;
  sourceType: string;
  payload?: JsonValue;
}

export interface WorkflowEventSubscription {
  id: string;
  eventTriggers?: WorkflowEventTrigger[];
}

export interface WorkflowEventStarterDeps {
  listWorkflowsForEvent: (input: {
    userId: string;
    tenantId?: string;
    eventType: string;
    sourceId: string;
  }) => Promise<WorkflowEventSubscription[]>;
  createWorkflowEventRun: (input: {
    userId: string;
    tenantId?: string;
    workflowId: string;
    eventId: string;
    eventType: string;
    sourceId: string;
    input?: string;
    now: Date;
  }) => Promise<unknown | null>;
  /** Nudges the runner once a new run is durable. */
  wake: () => void;
  now?: () => Date;
}

const MAX_EVENT_PAYLOAD_CHARS = 4_000;
/** Internal bookkeeping and workflow dispatch never re-enter workflow triggers. */
const NON_TRIGGERING_SOURCE_TYPES = new Set(['internal', 'workflow']);

export function isWorkflowTriggerableEvent(event: WorkflowAgentEvent): boolean {
  return (
    event.eventType !== 'workflow.step' &&
    !NON_TRIGGERING_SOURCE_TYPES.has(event.sourceType) &&
    event.eventId.length > 0 &&
    event.sourceId.length > 0
  );
}

function eventContext(event: WorkflowAgentEvent): string {
  const lines = [
    `Event type: ${event.eventType}`,
    `Source: ${event.sourceId}`,
    `Event id: ${event.eventId}`,
  ];
  if (event.payload !== undefined) {
    lines.push(`Payload:\n${JSON.stringify(event.payload).slice(0, MAX_EVENT_PAYLOAD_CHARS)}`);
  }
  return lines.join('\n').slice(0, WORKFLOW_RUN_INPUT_MAX_LENGTH);
}

/**
 * Starts one run per authenticated event occurrence. The durable write is keyed
 * by workflow, source and event id, so a replayed webhook, a retried delivery or
 * a second replica cannot start the same occurrence twice.
 */
export function createWorkflowEventStarter(deps: WorkflowEventStarterDeps) {
  const now = deps.now ?? (() => new Date());
  return async (event: WorkflowAgentEvent): Promise<number> => {
    if (!isWorkflowTriggerableEvent(event)) {
      return 0;
    }
    const workflows = await deps.listWorkflowsForEvent({
      userId: event.userId,
      ...(event.tenantId == null ? {} : { tenantId: event.tenantId }),
      eventType: event.eventType,
      sourceId: event.sourceId,
    });
    let started = 0;
    for (const workflow of workflows) {
      const trigger = (workflow.eventTriggers ?? []).find(
        (entry) =>
          entry.eventType === event.eventType &&
          (entry.sourceId == null || entry.sourceId === event.sourceId),
      );
      if (trigger == null) {
        continue;
      }
      const run = await deps.createWorkflowEventRun({
        userId: event.userId,
        ...(event.tenantId == null ? {} : { tenantId: event.tenantId }),
        workflowId: workflow.id,
        eventId: event.eventId,
        eventType: event.eventType,
        sourceId: event.sourceId,
        // The data layer prepends this trigger's configured input, so only the
        // concrete occurrence is composed here.
        input: eventContext(event),
        now: now(),
      });
      if (run != null) {
        started += 1;
      }
    }
    if (started > 0) {
      deps.wake();
    }
    return started;
  };
}
