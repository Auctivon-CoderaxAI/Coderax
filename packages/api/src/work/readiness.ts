import type {
  FreeInferenceCatalogState,
  TWorkReadinessAction,
} from 'coderax-data-provider';
import type { WorkAgentOption } from './agents';
import type { WorkModel } from './models';

/**
 * Work runs when at least one free or local model is offered. A saved agent is
 * optional because automatic Work can run directly on an offered model. Hosted
 * free inference is one way to satisfy the model check; a local endpoint is
 * another, so its opt-in flag is reported as context rather than being required.
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
  /** Stable action data for clients to localize. */
  nextActionDescriptor: TWorkReadinessAction | null;
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
        .filter((endpoint) => endpoint.blocked === 'missing_credential')
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
      detail: describeCredentialDetail(catalog, credentialed.length, missing),
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
      required: false,
      ok: input.agents.length > 0,
      detail:
        input.agents.length > 0
          ? `${input.agents.length} accessible agent(s) run entirely on an offered model.`
          : 'No saved agent is pinned to an offered model; automatic Work can run directly on an offered model.',
    },
  ];

  const failing = checks.find((check) => check.required && !check.ok);
  const nextActionDescriptor = failing ? nextActionFor(failing, catalog, missing) : null;
  return {
    ready: failing == null,
    checks,
    nextAction: nextActionDescriptor ? describeNextAction(nextActionDescriptor) : null,
    nextActionDescriptor,
  };
}

function describeCredentialDetail(
  catalog: FreeInferenceCatalogState,
  credentialedCount: number,
  missing: string[],
): string {
  if (credentialedCount > 0) {
    return `${credentialedCount} verified free endpoint(s) have a server-side credential.`;
  }
  if (missing.length > 0) {
    return `No executable free endpoint has a credential. Missing: ${missing.join(', ')}.`;
  }
  if (catalog.endpoints.some((endpoint) => endpoint.blocked === 'endpoint_name_conflict')) {
    return 'A reserved free-provider endpoint name points to a different URL or model list.';
  }
  if (catalog.endpoints.some((endpoint) => endpoint.blocked === 'billing_plan_unverified')) {
    return 'Free-tier or daily-allocation endpoints are blocked because their account plan cannot be verified.';
  }
  if (catalog.endpoints.some((endpoint) => endpoint.blocked === 'unsupported_transport')) {
    return 'No verified free endpoint is executable with the current transport.';
  }
  return 'No verified free endpoint is executable with the current policy.';
}

function nextActionFor(
  check: WorkReadinessCheck,
  catalog: FreeInferenceCatalogState,
  missing: string[],
): TWorkReadinessAction {
  switch (check.id) {
    case 'free_inference_enabled':
      return { id: 'enable_free_inference' };
    case 'provider_credential':
      return { id: 'set_provider_credential', envName: missing[0] ?? null };
    case 'eligible_model':
      if (!catalog.enabled) {
        return { id: 'configure_local_or_free_model' };
      }
      if (missing.length > 0) {
        return { id: 'set_provider_credential', envName: missing[0] };
      }
      if (catalog.endpoints.some((endpoint) => endpoint.blocked === 'endpoint_name_conflict')) {
        return { id: 'correct_endpoint_name_conflict' };
      }
      if (catalog.endpoints.some((endpoint) => endpoint.blocked === 'billing_plan_unverified')) {
        return { id: 'use_verified_free_or_local_model' };
      }
      return { id: 'inspect_rejected_free_endpoint' };
    case 'eligible_agent':
      return { id: 'create_agent_after_model_available' };
  }
}

function describeNextAction(action: TWorkReadinessAction): string {
  switch (action.id) {
    case 'enable_free_inference':
      return 'Set freeInference.enabled: true in coderax.yaml, then restart the server.';
    case 'set_provider_credential':
      return 'Set ' + (action.envName ?? 'a free-provider key') + ' on the server, then restart so the catalog is rebuilt.';
    case 'configure_local_or_free_model':
      return 'Configure a local endpoint (for example Ollama) or enable freeInference with a credential.';
    case 'correct_endpoint_name_conflict':
      return 'Rename or correct the existing reserved free-provider endpoint, then restart the server.';
    case 'use_verified_free_or_local_model':
      return 'Use a verified $0 model endpoint or a local model; account-plan-based free tiers stay blocked.';
    case 'inspect_rejected_free_endpoint':
      return 'Check the server log for a rejected free endpoint, then restart so the catalog is rebuilt.';
    case 'create_agent_after_model_available':
      return 'Create an agent after a free or local model is offered.';
  }
}
