const { randomUUID } = require('node:crypto');

let engine;
let eventStarter;

/**
 * Build the workflow runner on first use. The engine owns only orchestration:
 * step dispatch is the same durable trigger path every other agent turn uses,
 * completion is read from the conversation's generation job, and schedules are
 * the same cadence rules chat schedules use.
 */
function getEngine() {
  if (engine != null) {
    return engine;
  }
  const {
    createWorkflowEngine,
    createWorkflowSchedules,
    createWorkflowStepEnqueuer,
    createWorkflowStore,
    computeNextRunAt,
    GenerationJobManager,
  } = require('@coderax/api');
  const { enqueueAgentTrigger } = require('~/server/services/Agents/triggers');
  const methods = require('~/models');

  const runner = createWorkflowEngine({
    store: createWorkflowStore(methods),
    enqueueStep: createWorkflowStepEnqueuer({ enqueueTrigger: enqueueAgentTrigger }),
    getGeneration: (conversationId) => GenerationJobManager.getJob(conversationId),
    abortGeneration: (conversationId, options) =>
      abortWorkflowTurn(conversationId, options?.expectedCreatedAt),
    readStepResult: async ({ run, conversationId }) => {
      const messages = await methods.getMessages(
        { conversationId, user: run.userId },
        'text isCreatedByUser',
      );
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message.isCreatedByUser === false && typeof message.text === 'string') {
          const text = message.text.trim();
          if (text.length > 0) {
            return text;
          }
        }
      }
      return null;
    },
    onRunSettled: async (run) => {
      if (run.status !== 'completed' || run.onCompleteWorkflowId == null) {
        return;
      }
      const next = await methods.getWorkflow(run.onCompleteWorkflowId, run.userId);
      if (next == null) {
        return;
      }
      await methods.createWorkflowRun({
        userId: run.userId,
        ...(run.tenantId == null ? {} : { tenantId: run.tenantId }),
        workflowId: next.id,
        workflowName: next.name,
        agentId: next.agentId,
        steps: next.steps,
        conversationId: randomUUID(),
        ...(next.settings == null ? {} : { settings: next.settings }),
        ...(next.onCompleteWorkflowId == null
          ? {}
          : { onCompleteWorkflowId: next.onCompleteWorkflowId }),
        trigger: {
          type: 'event',
          sourceId: run.workflowId,
          label: run.workflowName,
        },
      });
      engine.wake();
    },
    schedules: createWorkflowSchedules({
      claimDue: methods.claimDueWorkflowSchedules,
      complete: methods.completeWorkflowScheduleClaim,
      release: methods.releaseWorkflowScheduleClaim,
      nextRunAt: ({ cadence, timezone, after, workflowId }) =>
        computeNextRunAt({ cadence, timezone, after, scheduleId: workflowId }),
    }),
  });
  engine = runner;
  return runner;
}

/**
 * Aborts the turn currently producing in a conversation. Identity-fenced when
 * the caller knows which generation it authorized, so a replacement turn that
 * reused the conversation is never stopped by a stale cancellation.
 */
async function abortWorkflowTurn(conversationId, expectedCreatedAt) {
  const { GenerationJobManager } = require('@coderax/api');
  const job = await GenerationJobManager.getJob(conversationId);
  if (job == null) {
    return false;
  }
  if (job.status !== 'running' && job.status !== 'requires_action') {
    return false;
  }
  if (expectedCreatedAt != null && job.createdAt !== expectedCreatedAt) {
    return false;
  }
  const result = await GenerationJobManager.abortJob(conversationId, {
    expectedCreatedAt: job.createdAt,
  });
  return result?.success === true;
}

/** Starts the recovery poll once the database and job manager are ready. */
/**
 * Workflow event subscriptions are durable rows. The trigger lane calls this
 * after it accepted an authenticated event, and each occurrence is keyed by
 * workflow, source and event id so retries and multiple replicas cannot start
 * the same run twice.
 */
function getEventStarter() {
  if (eventStarter != null) {
    return eventStarter;
  }
  const { createWorkflowEventStarter } = require('@coderax/api');
  const methods = require('~/models');
  eventStarter = createWorkflowEventStarter({
    listWorkflowsForEvent: methods.listWorkflowsForEvent,
    createWorkflowEventRun: methods.createWorkflowEventRun,
    wake: wakeWorkflowEngine,
  });
  return eventStarter;
}

async function handleWorkflowAgentEvent(event) {
  return getEventStarter()(event);
}

/** Starts the recovery poll once the database and job manager are ready. */
function initializeWorkflowEngine() {
  try {
    getEngine().start();
    return true;
  } catch (error) {
    console.error('[workflows] engine initialization failed', error);
    return false;
  }
}

function wakeWorkflowEngine() {
  try {
    const runner = getEngine();
    runner.start();
    runner.wake();
  } catch (error) {
    console.error('[workflows] engine wake failed', error);
  }
}

// Register before any event can arrive. The trigger lane holds the callback, so
// it never requires this module and the two services stay acyclic.
const { setWorkflowEventHandler } = require('~/server/services/Agents/triggers');
setWorkflowEventHandler(handleWorkflowAgentEvent);

module.exports = {
  abortWorkflowTurn,
  getWorkflowEngine: getEngine,
  handleWorkflowAgentEvent,
  initializeWorkflowEngine,
  wakeWorkflowEngine,
};
