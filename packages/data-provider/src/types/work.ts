export const WORK_AUTO_MODEL_ID = 'auto';

/** Routing intents resolved by the server from the offered free/local models. */
export const WORK_ROUTING_MODES = ['auto', 'fast', 'complex', 'agent'] as const;
export type TWorkRoutingMode = (typeof WORK_ROUTING_MODES)[number];

export function isWorkRoutingMode(value: unknown): value is TWorkRoutingMode {
  return typeof value === 'string' && (WORK_ROUTING_MODES as readonly string[]).includes(value);
}

/** The owner-only OpenCode engine, selected by model id rather than a provider model. */
export const WORK_OPENCODE_ENGINE_ID = 'opencode' as const;
/** The owner-only Freebuff engine, selected by model id rather than a provider model. */
export const WORK_FREEBUFF_ENGINE_ID = 'freebuff' as const;
export type TWorkEngineId = typeof WORK_OPENCODE_ENGINE_ID | typeof WORK_FREEBUFF_ENGINE_ID;

/** The native Coderax agent is the default and never depends on an engine. */
export const WORK_CODERAX_AGENT_ID = 'coderax' as const;
export const WORK_OPENCODE_AGENT_ID = 'opencode' as const;
export const WORK_FREEBUFF_AGENT_ID = 'freebuff' as const;

/** Stable identities a Work conversation can be bound to for its whole life. */
export type TWorkAgentId =
  | typeof WORK_CODERAX_AGENT_ID
  | typeof WORK_OPENCODE_AGENT_ID
  | typeof WORK_FREEBUFF_AGENT_ID;

export type TWorkAgentKind = 'native' | 'external';

/** Safe availability for one identity; never contains a path or credential. */
export type TWorkAgentIdentityAvailability =
  | { available: true }
  | { available: false; reason: string; detail?: string };

export type TWorkAgentIdentity = {
  id: TWorkAgentId;
  label: string;
  kind: TWorkAgentKind;
  /** The external execution engine, or null for Coderax Native. */
  engine: TWorkEngineId | null;
  description: string;
  availability: TWorkAgentIdentityAvailability;
};

export type TWorkAgentIdentitiesResponse = {
  defaultAgent: typeof WORK_CODERAX_AGENT_ID;
  agents: TWorkAgentIdentity[];
};

export type TWorkTaskState =
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'unknown';

export type TWorkTask = {
  id: string;
  title: string;
  state: TWorkTaskState;
  createdAt?: string;
  updatedAt?: string;
  /** The concrete model the server ran the latest turn on. */
  model?: string;
  /** The engine identity bound to this Work conversation. */
  workAgent?: TWorkAgentId;
  /** The saved agent the conversation runs, when it is not Coderax's default agent. */
  agentId?: string;
};

/** The concrete model the automatic option resolves to when a task starts now. */
export type TWorkModelTarget = {
  id: string;
  label: string;
  provider?: string;
};

export type TWorkModel = {
  id: string;
  label: string;
  provider?: string;
  auto?: true;
  /** Set on a routing option; `id` is the sentinel the client sends back. */
  routingMode?: TWorkRoutingMode;
  /** Marks a Coderax-managed execution engine rather than a provider-hosted model. */
  engine?: TWorkEngineId;
  target?: TWorkModelTarget;
};

export type TWorkModelsResponse = {
  models: TWorkModel[];
  /** Routing intents, each naming the concrete model it currently resolves to. */
  routingModes?: TWorkModel[];
};

/** An agent a handoff, chain or subagent graph can hand work to during one run. */
export type TWorkAgentMember = {
  id: string;
  name?: string;
  model: string;
  provider: string;
};

/**
 * An agent Work can run: the caller can view it and every agent its graph can
 * reach, and every one of them runs on a free or locally served model.
 */
export type TWorkAgent = {
  id: string;
  name?: string;
  description?: string;
  model: string;
  provider: string;
  members: TWorkAgentMember[];
};

export type TWorkAgentsResponse = { agents: TWorkAgent[] };

export type TWorkReadinessCheckId =
  | 'free_inference_enabled'
  | 'provider_credential'
  | 'eligible_model'
  | 'eligible_agent';

export type TWorkReadinessCheck = {
  id: TWorkReadinessCheckId;
  ok: boolean;
  required: boolean;
  detail: string;
};

export type TWorkReadinessAction =
  | { id: 'enable_free_inference' }
  | { id: 'set_provider_credential'; envName: string | null }
  | { id: 'configure_local_or_free_model' }
  | { id: 'correct_endpoint_name_conflict' }
  | { id: 'use_verified_free_or_local_model' }
  | { id: 'inspect_rejected_free_endpoint' }
  | { id: 'create_agent_after_model_available' };

export type TWorkReadiness = {
  ready: boolean;
  checks: TWorkReadinessCheck[];
  nextAction: string | null;
  /** Stable action data for clients to localize; prefer this over display text. */
  nextActionDescriptor?: TWorkReadinessAction | null;
};

export type TWorkReadinessResponse = { readiness: TWorkReadiness };

export type TWorkTasksResponse = { tasks: TWorkTask[] };
export type TWorkTaskResponse = { task: TWorkTask };

/** The preferred model and why it is or is not serving, without credentials. */
export type TWorkRoutingPrimary = {
  available: boolean;
  label: string;
  modelIds: readonly string[];
  reason?: string;
  checkedAt: string;
  evidence: ReadonlyArray<{ url: string; detail: string }>;
};

export type TWorkRoutingEndpoint = {
  id: string;
  provider: string;
  modelId: string;
  label: string;
  kind: 'primary' | 'fallback';
  freeEligible: boolean;
  credentialPresent: boolean;
  healthy: boolean;
  available: boolean;
  rejectionReason:
    | 'unknown_provider'
    | 'unverified_pricing'
    | 'billing_plan_unverified'
    | 'endpoint_name_conflict'
    | 'trial_credits'
    | 'nonzero_price'
    | 'distilled_model_as_primary'
    | 'cooldown'
    | 'quota'
    | 'rate_limit'
    | 'fallback_disabled'
    | 'disabled'
    | 'missing_credential'
    | 'tools_unavailable'
    | null;
  cooldownUntil: number | null;
  tools: boolean;
  quota: {
    requestsUsed: number;
    requestsLimit: number;
    tokensUsed: number;
    tokensLimit: number;
    resetAt: number;
    requestsPerMinuteUsed: number | null;
    requestsPerMinuteLimit: number | null;
    requestsPerMinuteResetAt: number | null;
  };
};

/** What a new Work turn would run on, and the free budget behind it. */
export type TWorkRoutingSnapshot = {
  enabled: boolean;
  primary: TWorkRoutingPrimary;
  activeModel: { provider: string; modelId: string; label: string } | null;
  endpoints: TWorkRoutingEndpoint[];
  paidRoutesEnabled: false;
};

export type TWorkRoutingResponse = { routing: TWorkRoutingSnapshot };
