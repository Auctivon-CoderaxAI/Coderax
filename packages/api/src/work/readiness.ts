import type { FreeInferenceCatalogState } from 'coderax-data-provider';
import type { WorkAgentOption } from './agents';
import type { WorkModel } from './models';

/**
 * Work runs when at least one free or local model is offered and an accessible
 * agent is pinned to it. Hosted free inference is one way to satisfy the model
 * check; a local endpoint is another, so its opt-in flag is reported as context
 * rather than being required.
 */
export type WorkReadinessCheckId =
  | 'free_inference_enabled'
  | 'provider_credential'
  | 'eligible_model'
  | 'eligible_agent';

export type WorkReadinessCheck = {
  id: WorkReadinessCheckId;
  ok: boolean;
  /** A required check decides `ready`; contextual checks only explain it. */
  required: boolean;
  /** Safe to log: counts, variable names and model ids, never a key value. */
  detail: string;
};

export type WorkReadiness = {
  ready: boolean;
  checks: WorkReadinessCheck[];
  /** The single next step, or null when every required check passes. */
  nextAction: string | null;
};

const DISABLED_CATALOG: FreeInferenceCatalogState = {
  enabled: false,
  endpoints: [],
  executableProviders: [],
};

export function describeWorkReadiness(input: {
  catalog?: FreeInferenceCatalogState | null;
  models: WorkModel[];
  agents: WorkAgentOption[];
}): WorkReadiness {
  const catalog = input.catalog ?? DISABLED_CATALOG;
  const concrete = input.models.filter((model) => model.auto !== true);
  const credentialed = catalog.endpoints.filter(
    (endpoint) => endpoint.credentialPresent && endpoint.executable,
  );
  const missing = [
    ...new Set(
      catalog.endpoints
        .filter((endpoint) => !endpoint.credentialPresent)
        .map((endpoint) => endpoint.credentialEnv),
    ),
  ].sort();

  const checks: WorkReadinessCheck[] = [
    {
      id: 'free_inference_enabled',
      required: false,
      ok: catalog.enabled,
      detail: catalog.enabled
        ? 'freeInference.enabled is true.'
        : 'freeInference.enabled is false; only locally configured models are offered.',
    },
    {
      id: 'provider_credential',
      required: false,
      ok: credentialed.length > 0,
      detail: describeCredentialDetail(credentialed.length, missing),
    },
    {
      id: 'eligible_model',
      required: true,
      ok: concrete.length > 0,
      detail:
        concrete.length > 0
          ? `${concrete.length} free or local model(s) are offered to Work.`
          : 'Work offers no free or local model.',
    },
    {
      id: 'eligible_agent',
      required: true,
      ok: input.agents.length > 0,
      detail:
        input.agents.length > 0
          ? `${input.agents.length} accessible agent(s) run entirely on an offered model.`
          : 'No accessible agent is pinned to an offered model.',
    },
  ];

  const failing = checks.find((check) => check.required && !check.ok);
  return {
    ready: failing == null,
    checks,
    nextAction: failing ? nextActionFor(failing, catalog, concrete, missing) : null,
  };
}

function describeCredentialDetail(credentialedCount: number, missing: string[]): string {
  if (credentialedCount > 0) {
    return `${credentialedCount} verified free endpoint(s) have a server-side credential.`;
  }
  if (missing.length > 0) {
    return `No executable free endpoint has a credential. Missing: ${missing.join(', ')}.`;
  }
  return 'No verified free endpoint is executable with the current transport.';
}

function nextActionFor(
  check: WorkReadinessCheck,
  catalog: FreeInferenceCatalogState,
  models: WorkModel[],
  missing: string[],
): string {
  switch (check.id) {
    case 'free_inference_enabled':
      return 'Set freeInference.enabled: true in coderax.yaml, then restart the server.';
    case 'provider_credential':
      return `Set ${missing[0] ?? 'a free-provider key'} on the server, then restart so the catalog is rebuilt.`;
    case 'eligible_model':
      if (catalog.enabled) {
        return missing.length > 0
          ? `Set ${missing[0]} on the server, then restart so the catalog is rebuilt.`
          : 'Check the server log for a rejected free endpoint, then restart so the catalog is rebuilt.';
      }
      return 'Configure a local endpoint (for example Ollama) or enable freeInference with a credential.';
    case 'eligible_agent': {
      const target = models[0];
      return target
        ? `Create an agent with provider "${target.provider}" and model "${target.id}".`
        : 'Create an agent after a free or local model is offered.';
    }
  }
}
