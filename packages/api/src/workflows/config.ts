import type { WorkflowEngineOptions } from './types';

/** The configured fields startup validation reads from one stateful-code environment. */
export interface ConfiguredWorkflowCodeEnvironment {
  id: string;
  type?: string;
}

export class WorkflowBuildWorkspaceConfigurationError extends Error {
  readonly code = 'WORKFLOW_BUILD_WORKSPACE_CONFIGURATION';

  constructor(message: string) {
    super(message);
    this.name = 'WorkflowBuildWorkspaceConfigurationError';
  }
}

/**
 * A build step's turn is bound to `workspaceEnvironmentId` on the configured
 * attached machine. Checking at startup keeps a typo in that id from surfacing
 * later as a generic failed build step; arming refuses the whole runner instead.
 */
export function validateBuildWorkspaceEnvironment(
  options: WorkflowEngineOptions | undefined,
  environments: readonly ConfiguredWorkflowCodeEnvironment[] | undefined,
): void {
  const build = options?.buildVerification;
  if (build == null) {
    return;
  }
  const environmentId = build.workspaceEnvironmentId;
  const environment = environments?.find((candidate) => candidate.id === environmentId);
  if (environment == null) {
    const configured = (environments ?? [])
      .map((candidate) => candidate.id)
      .filter((id) => id.length > 0);
    throw new WorkflowBuildWorkspaceConfigurationError(
      `workflows.buildVerification.workspaceEnvironmentId "${environmentId}" is not a configured ` +
        'stateful-code environment. ' +
        (configured.length === 0
          ? 'No environments are configured under endpoints.agents.statefulCodeSessions.environments.'
          : `Configured environments: ${configured.join(', ')}.`),
    );
  }
  if (environment.type !== 'attached') {
    throw new WorkflowBuildWorkspaceConfigurationError(
      `workflows.buildVerification.workspaceEnvironmentId "${environmentId}" must name an attached ` +
        `stateful-code environment; it is configured as ${environment.type ?? 'an unknown type'}.`,
    );
  }
}
