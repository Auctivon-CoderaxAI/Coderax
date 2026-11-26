import type { WorkflowEngineGateway, WorkflowEngineGatewayLogger } from './router';
import type { WorkflowEngineGatewayOptions } from './config';
import type { CompatibilityReport } from './compat';

/**
 * Startup orchestration belongs here, not in the CJS route module.
 *
 * The handshake runs in the background. An unverified startup makes gateway
 * requests recheck readiness before dispatch; existing Coderax routes are unaffected.
 */

export type GatewayStartupDeps = {
  gateway: Pick<WorkflowEngineGateway, 'prewarm'>;
  resolveConfig: () =>
    | WorkflowEngineGatewayOptions
    | null
    | undefined
    | Promise<WorkflowEngineGatewayOptions | null | undefined>;
  logger?: WorkflowEngineGatewayLogger;
  env?: NodeJS.ProcessEnv;
};

function failureCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String((error as { code: unknown }).code);
  }
  return 'unknown';
}

/** Runs one startup check. Exposed so the behavior can be tested without a process. */
export async function runWorkflowEngineStartup(
  deps: GatewayStartupDeps,
): Promise<CompatibilityReport | null> {
  try {
    return await deps.gateway.prewarm(await deps.resolveConfig());
  } catch (error) {
    // Never log the error text: a loader or transport failure may carry a host.
    deps.logger?.warn?.(`[workflow-engine] startup check skipped: ${failureCode(error)}`);
    return null;
  }
}

/** Starts the check once at module load, except under Jest. */
export function startWorkflowEngineGateway(deps: GatewayStartupDeps): void {
  const env = deps.env ?? process.env;
  if (env.NODE_ENV === 'test') {
    return;
  }
  void runWorkflowEngineStartup(deps);
}
