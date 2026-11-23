let lifecycle;
let eventStarter;

/**
 * Build the workflow runner on first use. The engine and every lifecycle,
 * settlement, admission and abort behavior live in @coderax/api; this module
 * only supplies the app's store, trigger lane and generation manager.
 */
function buildEngine(options) {
  const {
    GenerationJobManager,
    computeNextRunAt,
    createWorkflowConversationResultReader,
    createWorkflowEngine,
    createWorkflowSchedules,
    createWorkflowSettlementHandler,
    createWorkflowStepEnqueuer,
    createWorkflowStepResultReader,
    createWorkflowStore,
    createWorkflowTerminalOutcomeHandler,
    createBuildVerifier,
  } = require('@coderax/api');
  const { enqueueAgentTrigger } = require('~/server/services/Agents/triggers');
  const methods = require('~/models');
  GenerationJobManager.setTerminalHostActionHandler(
    createWorkflowTerminalOutcomeHandler({
      record: methods.recordWorkflowStepOutcome,
      readResult: createWorkflowConversationResultReader(methods),
      wake: wakeWorkflowEngine,
    }),
  );

  return createWorkflowEngine(
    {
      store: createWorkflowStore(methods),
      enqueueStep: createWorkflowStepEnqueuer({
        enqueueTrigger: enqueueAgentTrigger,
        // Build steps edit the run's reserved checkout, so their turns are
        // bound to the workspace id that names it on that attached machine.
        buildWorkspaceEnvironmentId: options?.buildVerification?.workspaceEnvironmentId,
      }),
      getGeneration: (conversationId) => GenerationJobManager.getJob(conversationId),
      abortGeneration: (conversationId, abortOptions) =>
        abortWorkflowTurn(conversationId, abortOptions?.expectedCreatedAt),
      readStepResult: createWorkflowStepResultReader(methods),
      // Settlement verification is deployment policy: the workspace, the
      // attached machine that hosts it and the argv come from config, never
      // from a build request body. Without it a build run fails closed instead
      // of settling complete unverified.
      verifyRun:
        options?.buildVerification == null
          ? undefined
          : createBuildVerifier(options.buildVerification),
      onRunSettled: createWorkflowSettlementHandler({
        methods,
        wake: wakeWorkflowEngine,
      }),
      schedules: createWorkflowSchedules({
        claimDue: methods.claimDueWorkflowSchedules,
        complete: methods.completeWorkflowScheduleClaim,
        release: methods.releaseWorkflowScheduleClaim,
        nextRunAt: ({ cadence, timezone, after, workflowId }) =>
          // The initial occurrence is persisted without jitter in handlers.ts.
          // Advancing with jitter would select that same occurrence again.
          computeNextRunAt({
            cadence,
            timezone,
            after,
            scheduleId: workflowId,
            disableJitter: true,
          }),
      }),
    },
    options,
  );
}

function getLifecycle() {
  if (lifecycle == null) {
    const { createWorkflowLifecycle } = require('@coderax/api');
    lifecycle = createWorkflowLifecycle(buildEngine);
  }
  return lifecycle;
}

function getEngine() {
  return getLifecycle().getEngine();
}

async function abortWorkflowTurn(conversationId, expectedCreatedAt) {
  const { GenerationJobManager, createWorkflowTurnAborter } = require('@coderax/api');
  return createWorkflowTurnAborter({
    getJob: (id) => GenerationJobManager.getJob(id),
    abortJob: (id, options) => GenerationJobManager.abortJob(id, options),
  })(conversationId, expectedCreatedAt);
}

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

/** Arms the recovery poll with the deployment's configured runner limits. The
 *  configured code environments are checked before the runner starts, so a bad
 *  build workspace id fails startup instead of every build step later. */
function initializeWorkflowEngine(options, environments) {
  return getLifecycle().initialize(options, environments);
}

function wakeWorkflowEngine() {
  getLifecycle().wake();
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
