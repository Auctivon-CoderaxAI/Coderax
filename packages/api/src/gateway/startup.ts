/**
 * Startup orchestration for the WorkflowEngine gateway.
 *
 * The compatibility handshake runs once, without a request, and is deliberately
 * fire-and-forget and fail-closed: a failed check leaves every gateway route
 * answering 503, and it never blocks or rewrites an existing Coderax route.
 * `/api` hands this module the deployment config and the mounted gateway instead
 * of carrying the branch itself.
 */

import type { WorkflowEngineGatewayOptions } from './config';
import type { WorkflowEngineGateway } from './router';
import type { CompatibilityReport } from './compat';

export type WorkflowEngineStartupLogger = {
  info?: (message: string) => void;
  warn?: (message: string, meta?: { error: string }) => void;
  error?: (message: string) => void;
};

export type WorkflowEngineStartupDeps = {
  resolveConfig: () =>
    | WorkflowEngineGatewayOptions
    | null
    | undefined
    | Promise<WorkflowEngineGatewayOptions | null | undefined>;
  gateway: Pick<WorkflowEngineGateway, 'prewarm'>;
  logger?: WorkflowEngineStartupLogger;
  env?: NodeJS.ProcessEnv;
};

/**
 * Runs the startup handshake once. An unreadable configuration is a log line,
 * not a crash: the request path re-reads it and fails closed there.
 */
export async function prewarmWorkflowEngine(
  deps: WorkflowEngineStartupDeps,
): Promise<CompatibilityReport | null> {
  try {
    const config = await deps.resolveConfig();
    if (config?.startupCheck === false) {
      return null;
    }
    return await deps.gateway.prewarm(config);
  } catch (error) {
    deps.logger?.warn?.('[workflow-engine] startup check skipped', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Arms the startup handshake; test processes never reach a real engine. */
export function startWorkflowEnginePrewarm(deps: WorkflowEngineStartupDeps): void {
  if ((deps.env ?? process.env).NODE_ENV === 'test') {
    return;
  }
  void prewarmWorkflowEngine(deps);
}
