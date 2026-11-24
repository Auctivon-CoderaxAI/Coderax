/**
 * Zero-cost hosted inference catalog.
 *
 * Every entry is a provider endpoint whose documented price for the usage
 * Coderax makes of it is $0: a free model variant, a free tier, or a free daily
 * allocation. The catalog is an allowlist, not a hint — an endpoint that is not
 * listed is never routed to, and `assertZeroCostEndpoint` rejects trial
 * credits, unknown billing and any non-zero price.
 *
 * Full DeepSeek-R1 671B is the preferred model. On 2026-11-08 no provider
 * served it on a verified free plan, so `DEEPSEEK_R1_PRIMARY` records that
 * finding rather than substituting a distilled checkpoint. A distilled model
 * is never reported as the 671B model.
 */

export type FreeProviderId = 'openrouter' | 'groq' | 'cloudflare';

/** How an endpoint stays at $0 for Coderax's usage. */
export type FreePricingBasis = 'free-model' | 'free-tier' | 'free-daily-allocation';

export type FreeEndpointCapabilities = {
  streaming: boolean;
  tools: boolean;
  reasoning: boolean;
};

export type FreeEndpointPricing = {
  basis: FreePricingBasis;
  /** ISO date the provider's price page was read. */
  verifiedAt: string;
  /** The page that states the price. */
  evidenceUrl: string;
  /** The terms Coderax relies on, kept short. */
  note: string;
};

export type FreeEndpoint = {
  /** Stable identity used by health, quota and the UI. */
  id: string;
  provider: FreeProviderId;
  /** Exact provider model identifier sent on the wire. */
  modelId: string;
  label: string;
  kind: 'primary' | 'fallback';
  baseURL: string;
  /** Server-side environment variable holding the credential. Never a config value. */
  apiKeyEnv: string;
  pricing: FreeEndpointPricing;
  capabilities: FreeEndpointCapabilities;
  contextTokens: number;
  /** Lower runs first. Operator preference, not a measured benchmark score. */
  routingPriority: number;
  /** Optional provider-documented ceilings; absent means the app budget governs. */
  dailyRequestLimit?: number;
  /** Optional provider-documented request limit over a rolling minute window. */
  requestsPerMinuteLimit?: number;
  /** Share one provider-account quota across model aliases when required. */
  quotaGroup?: string;
  /** A non-zero rate here would make the endpoint chargeable and is rejected. */
  promptCostPerMillion?: number;
  completionCostPerMillion?: number;
  /** Last measured latency of an authenticated minimal turn, when one exists. */
  observedLatencyMs?: number;
  /** ISO date observedLatencyMs was measured. */
  observedLatencyAt?: string;
};

export type FreeEndpointRejection =
  | 'unknown_provider'
  | 'unverified_pricing'
  | 'billing_plan_unverified'
  | 'endpoint_name_conflict'
  | 'trial_credits'
  | 'nonzero_price'
  | 'distilled_model_as_primary';

export type FreePrimaryUnavailableReason = 'no_verified_free_endpoint' | 'no_configured_credential';

export type FreePrimaryEvidence = {
  url: string;
  detail: string;
};

export type FreePrimaryStatus = {
  available: boolean;
  label: string;
  /** The exact model identifiers the preferred model may arrive under. */
  modelIds: readonly string[];
  reason?: FreePrimaryUnavailableReason;
  checkedAt: string;
  evidence: readonly FreePrimaryEvidence[];
};

/** The preferred inference model. Never a distilled checkpoint. */
export const DEEPSEEK_R1_671B = {
  label: 'DeepSeek-R1 671B',
  parameterCount: '671B',
  exactModelIds: [
    'deepseek/deepseek-r1-0528',
    'deepseek-ai/DeepSeek-R1',
    'deepseek-r1',
    'deepseek-reasoner',
  ],
} as const;

/**
 * A model identifier that names a smaller derivative of R1. These are rejected
 * as the preferred model even when the provider calls them "DeepSeek R1".
 */
const DISTILLED_HINTS = ['distill', 'lite', 'qwen', 'llama', 'mistral', 'gemma'];

/** True only for an identifier of the full 671B checkpoint. */
export function isFullDeepSeekR1(modelId: string): boolean {
  const value = modelId.trim().toLowerCase();
  if (!value || DISTILLED_HINTS.some((hint) => value.includes(hint))) {
    return false;
  }
  return (
    DEEPSEEK_R1_671B.exactModelIds.some((id) => id.toLowerCase() === value) ||
    /^deepseek(-ai)?\/deepseek-r1(-0528)?$/.test(value)
  );
}

/**
 * The live finding that blocks the preferred model. Kept in code so the router
 * and the UI state the same reason instead of each inventing one.
 */
export const DEEPSEEK_R1_PRIMARY: FreePrimaryStatus = {
  available: false,
  label: DEEPSEEK_R1_671B.label,
  modelIds: DEEPSEEK_R1_671B.exactModelIds,
  reason: 'no_verified_free_endpoint',
  checkedAt: '2026-11-08',
  evidence: [
    {
      url: 'https://openrouter.ai/api/v1/models',
      detail:
        'The only full R1 checkpoint listed, deepseek/deepseek-r1-0528, is priced $0.50/M input and $2.15/M output. No :free variant of it is offered.',
    },
    {
      url: 'https://developers.cloudflare.com/workers-ai/platform/pricing/',
      detail:
        'Workers AI lists only @cf/deepseek-ai/deepseek-r1-distill-qwen-32b, a distilled 32B model, not the 671B checkpoint.',
    },
    {
      url: 'https://console.groq.com/docs/rate-limits',
      detail:
        'Groq currently serves openai/gpt-oss and qwen models on its base limits; no DeepSeek-R1 671B endpoint is listed.',
    },
  ],
};

/** Providers Coderax can prove stay at $0. Anything else is rejected, not disabled. */
export const FREE_OPENROUTER_NAME = 'FreeOpenRouter';
export const FREE_OPENROUTER_URL = 'https://openrouter.ai/api/v1';
export const FREE_OPENROUTER_KEY_REF = '${OPENROUTER_API_KEY}';

export const FREE_PROVIDER_ALLOWLIST: readonly FreeProviderId[] = ['openrouter'];

/**
 * Candidate fallbacks, best first. The policy below removes endpoints whose
 * account tier or billing behavior cannot be verified at runtime.
 * `routingPriority` is an operator preference, not a benchmark result.
 */
export const FREE_ENDPOINTS: readonly FreeEndpoint[] = [
  {
    id: 'openrouter-nemotron-ultra-free',
    provider: 'openrouter',
    modelId: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    label: 'NVIDIA Nemotron 3 Ultra (free)',
    kind: 'fallback',
    baseURL: FREE_OPENROUTER_URL,
    apiKeyEnv: 'OPENROUTER_API_KEY',
    pricing: {
      basis: 'free-model',
      verifiedAt: '2026-11-22',
      evidenceUrl: 'https://openrouter.ai/api/v1/models',
      note: 'The :free variant is listed with prompt and completion price 0.',
    },
    capabilities: { streaming: true, tools: true, reasoning: true },
    contextTokens: 1_000_000,
    routingPriority: 10,
    observedLatencyMs: 1_801,
    observedLatencyAt: '2026-11-23',
    dailyRequestLimit: 50,
    requestsPerMinuteLimit: 20,
    quotaGroup: 'openrouter-free-account',
  },
  {
    id: 'groq-gpt-oss-120b',
    provider: 'groq',
    modelId: 'openai/gpt-oss-120b',
    label: 'OpenAI GPT-OSS 120B on Groq',
    kind: 'fallback',
    baseURL: 'https://api.groq.com/openai/v1',
    apiKeyEnv: 'GROQ_API_KEY',
    pricing: {
      basis: 'free-tier',
      verifiedAt: '2026-11-15',
      evidenceUrl: 'https://console.groq.com/docs/billing-faqs',
      note: 'Groq has both Free and billable Developer tiers. The API key does not reveal its account tier, so Coderax cannot verify that calls stay free.',
    },
    capabilities: { streaming: true, tools: false, reasoning: true },
    contextTokens: 32_768,
    routingPriority: 20,
    dailyRequestLimit: 1_000,
  },
  {
    id: 'openrouter-nemotron-lightning-free',
    provider: 'openrouter',
    modelId: 'nvidia/nemotron-3.5-lightning:free',
    label: 'NVIDIA Nemotron 3.5 Lightning (free)',
    kind: 'fallback',
    baseURL: FREE_OPENROUTER_URL,
    apiKeyEnv: 'OPENROUTER_API_KEY',
    pricing: {
      basis: 'free-model',
      verifiedAt: '2026-11-22',
      evidenceUrl: 'https://openrouter.ai/api/v1/models',
      note: 'The :free variant is listed with prompt and completion price 0.',
    },
    capabilities: { streaming: true, tools: true, reasoning: true },
    contextTokens: 1_000_000,
    routingPriority: 30,
    observedLatencyMs: 715,
    observedLatencyAt: '2026-11-23',
    dailyRequestLimit: 50,
    requestsPerMinuteLimit: 20,
    quotaGroup: 'openrouter-free-account',
  },
  {
    id: 'cloudflare-llama-3-3-70b-free',
    provider: 'cloudflare',
    modelId: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    label: 'Llama 3.3 70B on Workers AI',
    kind: 'fallback',
    baseURL: 'https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run',
    apiKeyEnv: 'CLOUDFLARE_TOKEN',
    pricing: {
      basis: 'free-daily-allocation',
      verifiedAt: '2026-11-22',
      evidenceUrl: 'https://developers.cloudflare.com/workers-ai/platform/pricing/',
      note: 'The daily allocation is free on the Workers Free plan, but the API does not expose the account plan to this router; paid-plan overage cannot be ruled out.',
    },
    capabilities: { streaming: true, tools: false, reasoning: false },
    contextTokens: 24_000,
    routingPriority: 40,
  },
  {
    id: 'openrouter-gemma-4-31b-free',
    provider: 'openrouter',
    modelId: 'google/gemma-4-31b-it:free',
    label: 'Google Gemma 4 31B (free)',
    kind: 'fallback',
    baseURL: FREE_OPENROUTER_URL,
    apiKeyEnv: 'OPENROUTER_API_KEY',
    pricing: {
      basis: 'free-model',
      verifiedAt: '2026-11-22',
      evidenceUrl: 'https://openrouter.ai/api/v1/models',
      note: 'The :free variant is listed with prompt and completion price 0.',
    },
    capabilities: { streaming: true, tools: true, reasoning: true },
    contextTokens: 262_144,
    routingPriority: 50,
    dailyRequestLimit: 50,
    requestsPerMinuteLimit: 20,
    quotaGroup: 'openrouter-free-account',
  },
];

export type FreeEndpointCheck = { ok: true } | { ok: false; reason: FreeEndpointRejection };

function isAbsoluteHttpUrl(value: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(value.trim());
}

/**
 * Enforce the hard zero-cost policy for one endpoint. Unknown providers,
 * unverified or trial pricing, and any non-zero rate are rejected rather than
 * used with a warning: a chargeable route must never exist at all.
 */
export function assertZeroCostEndpoint(endpoint: FreeEndpoint): FreeEndpointCheck {
  if (/trial|credit/i.test(endpoint.pricing.basis) || /trial credit/i.test(endpoint.pricing.note)) {
    return { ok: false, reason: 'trial_credits' };
  }
  if (
    (endpoint.promptCostPerMillion ?? 0) !== 0 ||
    (endpoint.completionCostPerMillion ?? 0) !== 0
  ) {
    return { ok: false, reason: 'nonzero_price' };
  }
  if (
    !isAbsoluteHttpUrl(endpoint.pricing.evidenceUrl) ||
    endpoint.pricing.verifiedAt.trim() === ''
  ) {
    return { ok: false, reason: 'unverified_pricing' };
  }
  // Free-tier and daily-allocation claims depend on the provider account plan.
  // The credential does not identify that plan, so fail closed instead of
  // risking usage-based billing on a Developer or paid account.
  if (endpoint.pricing.basis !== 'free-model') {
    return { ok: false, reason: 'billing_plan_unverified' };
  }
  if (!FREE_PROVIDER_ALLOWLIST.includes(endpoint.provider)) {
    return { ok: false, reason: 'unknown_provider' };
  }
  if (
    endpoint.kind === 'primary' &&
    /deepseek-r1/i.test(endpoint.modelId) &&
    !isFullDeepSeekR1(endpoint.modelId)
  ) {
    return { ok: false, reason: 'distilled_model_as_primary' };
  }
  return { ok: true };
}

export type FreeEndpointSelection = {
  usable: FreeEndpoint[];
  rejected: Array<{ id: string; reason: FreeEndpointRejection }>;
};

/**
 * Rank the allowlisted endpoints: the preferred model first, then by operator
 * priority. `requireTools` removes endpoints that cannot call tools, so a Work
 * turn never lands on one that would silently drop its tool definitions.
 */
export function selectFreeEndpoints(
  endpoints: readonly FreeEndpoint[],
  { requireTools = false }: { requireTools?: boolean } = {},
): FreeEndpointSelection {
  const rejected: FreeEndpointSelection['rejected'] = [];
  const usable: FreeEndpoint[] = [];
  for (const endpoint of endpoints) {
    const check = assertZeroCostEndpoint(endpoint);
    if (!check.ok) {
      rejected.push({ id: endpoint.id, reason: check.reason });
      continue;
    }
    if (requireTools && !endpoint.capabilities.tools) {
      continue;
    }
    usable.push(endpoint);
  }
  usable.sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === 'primary' ? -1 : 1;
    }
    if (a.routingPriority !== b.routingPriority) {
      return a.routingPriority - b.routingPriority;
    }
    return a.id.localeCompare(b.id);
  });
  return { usable, rejected };
}

/**
 * The preferred status for the deployment's catalog, with credentials unread.
 * A primary entry is trusted only after it passes the same allowlist and
 * identity checks as routing, so a distilled checkpoint can never be reported
 * as the preferred 671B model.
 */
export function describePrimaryStatus(endpoints: readonly FreeEndpoint[]): FreePrimaryStatus {
  const primary = endpoints.find(
    (endpoint) => endpoint.kind === 'primary' && assertZeroCostEndpoint(endpoint).ok,
  );
  if (!primary) {
    return DEEPSEEK_R1_PRIMARY;
  }
  return {
    available: true,
    label: primary.label,
    modelIds: [primary.modelId],
    checkedAt: primary.pricing.verifiedAt,
    evidence: [{ url: primary.pricing.evidenceUrl, detail: primary.pricing.note }],
  };
}

export type FreeInferenceEnv = Record<string, string | undefined>;

/** Inspect opt-in and the reserved provider endpoint identity; no other config is trusted. */
export type FreeInferenceConfigLike =
  | {
      freeInference?: { enabled?: boolean } | null;
      endpoints?: { custom?: unknown } | null;
    }
  | null
  | undefined;

export function isFreeInferenceEnabled(config: FreeInferenceConfigLike): boolean {
  return config?.freeInference?.enabled === true;
}

/**
 * Providers whose API is OpenAI-compatible, so Coderax's existing custom
 * endpoint client can execute them. Account-plan-dependent endpoints stay
 * blocked because the server cannot prove their usage will remain free.
 */
export const FREE_EXECUTABLE_PROVIDERS: readonly FreeProviderId[] = ['openrouter'];

export type FreeProviderEndpoint = {
  provider: 'openrouter' | 'groq';
  /** Stable provider id an agent is pinned to. */
  name: string;
  baseURL: string;
  label: string;
};

export const FREE_PROVIDER_ENDPOINTS: readonly FreeProviderEndpoint[] = [
  {
    provider: 'openrouter',
    name: FREE_OPENROUTER_NAME,
    baseURL: FREE_OPENROUTER_URL,
    label: 'OpenRouter (free)',
  },
];

export type FreeInferenceBlockReason =
  | FreeEndpointRejection
  | 'disabled'
  | 'missing_credential'
  | 'unsupported_transport';

export type FreeInferenceEndpointState = {
  id: string;
  provider: FreeProviderId;
  modelId: string;
  label: string;
  credentialEnv: string;
  credentialPresent: boolean;
  tools: boolean;
  /** Verified native reasoning support from the catalog entry. */
  reasoning?: boolean;
  /** Verified context window in tokens. */
  contextTokens?: number;
  /** Last measured latency of an authenticated minimal turn, when one exists. */
  observedLatencyMs?: number;
  /** ISO date observedLatencyMs was measured. */
  observedLatencyAt?: string;
  /** True only when opt-in, a server credential, policy and transport all agree. */
  executable: boolean;
  blocked: FreeInferenceBlockReason | null;
};

export type FreeExecutableProvider = {
  provider: string;
  name: string;
  models: string[];
};

export type FreeInferenceCatalogState = {
  enabled: boolean;
  endpoints: FreeInferenceEndpointState[];
  executableProviders: FreeExecutableProvider[];
};

export const DISABLED_FREE_INFERENCE_CATALOG: FreeInferenceCatalogState = {
  enabled: false,
  endpoints: [],
  executableProviders: [],
};

type CustomEndpointConfig = {
  name?: unknown;
  apiKey?: unknown;
  baseURL?: unknown;
  models?: { default?: unknown; fetch?: unknown } | null;
};

export function isFreeOpenRouterEndpoint(name: unknown): boolean {
  return typeof name === 'string' && name.toLowerCase() === FREE_OPENROUTER_NAME.toLowerCase();
}

export function isFreeOpenRouterModel(model: unknown): model is string {
  return (
    typeof model === 'string' &&
    model.endsWith(':free') &&
    FREE_ENDPOINTS.some(
      (endpoint) =>
        endpoint.provider === 'openrouter' &&
        endpoint.baseURL === FREE_OPENROUTER_URL &&
        endpoint.modelId === model &&
        assertZeroCostEndpoint(endpoint).ok,
    )
  );
}

const freeEndpointFields = new Set([
  'name',
  'apiKey',
  'baseURL',
  'models',
  'modelDisplayLabel',
  'titleConvo',
]);

/**
 * A deployment may already use a reserved free-provider name. Trust that
 * endpoint only when it still targets the canonical provider URL and lists the
 * exact free model; otherwise the Work catalog must not label it free.
 */
function hasCompatibleCustomEndpoint(
  config: FreeInferenceConfigLike,
  provider: FreeProviderEndpoint,
  modelId: string,
): boolean {
  const configured = config?.endpoints?.custom;
  if (configured === undefined) {
    return true;
  }
  if (!Array.isArray(configured)) {
    return false;
  }

  const matching = (configured as CustomEndpointConfig[]).filter((endpoint) =>
    isFreeOpenRouterEndpoint(endpoint?.name),
  );
  if (matching.length === 0) {
    return true;
  }
  if (matching.length !== 1) {
    return false;
  }

  const [endpoint] = matching;
  return (
    endpoint.name === provider.name &&
    endpoint.baseURL === provider.baseURL &&
    endpoint.apiKey === FREE_OPENROUTER_KEY_REF &&
    Object.keys(endpoint).every((key) => freeEndpointFields.has(key)) &&
    endpoint.models?.fetch !== true &&
    Array.isArray(endpoint.models?.default) &&
    endpoint.models.default.every(isFreeOpenRouterModel) &&
    endpoint.models.default.includes(modelId)
  );
}

/**
 * One source of truth for whether an endpoint can run a real turn right now.
 * Never reads a credential value, only whether the named variable is present.
 */
export function describeFreeInferenceCatalog(
  config: FreeInferenceConfigLike,
  env: FreeInferenceEnv | undefined,
): FreeInferenceCatalogState {
  const enabled = isFreeInferenceEnabled(config);
  const endpoints = FREE_ENDPOINTS.map((endpoint): FreeInferenceEndpointState => {
    const credentialPresent = Boolean(env?.[endpoint.apiKeyEnv]);
    const policy = assertZeroCostEndpoint(endpoint);
    const supported =
      FREE_EXECUTABLE_PROVIDERS.includes(endpoint.provider) &&
      isFreeOpenRouterModel(endpoint.modelId);
    const providerConfig = FREE_PROVIDER_ENDPOINTS.find(
      (candidate) => candidate.provider === endpoint.provider,
    );
    let blocked: FreeInferenceBlockReason | null = null;
    if (!enabled) {
      blocked = 'disabled';
    } else if (!policy.ok) {
      blocked = policy.reason;
    } else if (!credentialPresent) {
      blocked = 'missing_credential';
    } else if (!supported) {
      blocked = 'unsupported_transport';
    } else if (
      !providerConfig ||
      !hasCompatibleCustomEndpoint(config, providerConfig, endpoint.modelId)
    ) {
      blocked = 'endpoint_name_conflict';
    }
    return {
      id: endpoint.id,
      provider: endpoint.provider,
      modelId: endpoint.modelId,
      label: endpoint.label,
      credentialEnv: endpoint.apiKeyEnv,
      credentialPresent,
      tools: endpoint.capabilities.tools,
      reasoning: endpoint.capabilities.reasoning,
      contextTokens: endpoint.contextTokens,
      ...(endpoint.observedLatencyMs != null
        ? { observedLatencyMs: endpoint.observedLatencyMs }
        : {}),
      ...(endpoint.observedLatencyAt ? { observedLatencyAt: endpoint.observedLatencyAt } : {}),
      executable: blocked === null,
      blocked,
    };
  });

  const executableProviders = FREE_PROVIDER_ENDPOINTS.map((meta) => ({
    provider: meta.provider,
    name: meta.name,
    models: endpoints
      .filter((endpoint) => endpoint.executable && endpoint.provider === meta.provider)
      .map((endpoint) => endpoint.modelId),
  })).filter((group) => group.models.length > 0);

  return { enabled, endpoints, executableProviders };
}

/**
 * Turn verified $0 providers into ordinary custom endpoint entries, so the
 * native agent runner executes them without a second transport. The API key
 * stays an environment reference resolved server-side.
 */
export function buildFreeInferenceCustomEndpoints(
  config: FreeInferenceConfigLike,
  env: FreeInferenceEnv | undefined,
): Array<{
  name: string;
  baseURL: string;
  apiKey: string;
  modelDisplayLabel: string;
  models: { default: string[] };
  titleConvo: false;
}> {
  const catalog = describeFreeInferenceCatalog(config, env);
  return catalog.executableProviders.map((group) => {
    const meta = FREE_PROVIDER_ENDPOINTS.find((entry) => entry.provider === group.provider);
    const first = FREE_ENDPOINTS.find((entry) => entry.provider === group.provider);
    if (!meta || !first) {
      throw new Error('Free inference provider is missing its endpoint metadata');
    }
    return {
      name: meta.name,
      baseURL: meta.baseURL,
      apiKey: '${' + first.apiKeyEnv + '}',
      modelDisplayLabel: meta.label,
      models: { default: group.models },
      titleConvo: false,
    };
  });
}

/** The Work catalog rows that mirror the executable custom endpoints. */
export type FreeInferenceWorkSource = {
  id: string;
  label: string;
  provider: string;
  free: true;
  tools: boolean;
  reasoning: boolean;
  contextTokens: number;
  latencyMs?: number;
};

/**
 * Work runs tools, so only endpoints that advertise native tool calling are
 * offered. A text-only endpoint is never shown as a Work model.
 */
export function buildFreeInferenceWorkSources(
  config: FreeInferenceConfigLike,
  env: FreeInferenceEnv | undefined,
): FreeInferenceWorkSource[] {
  const catalog = describeFreeInferenceCatalog(config, env);
  const sources: FreeInferenceWorkSource[] = [];
  for (const group of catalog.executableProviders) {
    for (const endpoint of catalog.endpoints) {
      if (!endpoint.executable || endpoint.provider !== group.provider || !endpoint.tools) {
        continue;
      }
      sources.push({
        id: endpoint.modelId,
        label: endpoint.label,
        provider: group.name,
        free: true,
        tools: endpoint.tools,
        reasoning: endpoint.reasoning === true,
        contextTokens: endpoint.contextTokens ?? 0,
        ...(endpoint.observedLatencyMs != null ? { latencyMs: endpoint.observedLatencyMs } : {}),
      });
    }
  }
  return sources;
}

/**
 * Merge the executable free providers into a deployment config as custom
 * endpoints. Disabled free inference, a missing credential or an unsupported
 * transport adds nothing, so behavior is unchanged until opted in.
 */
export function mergeFreeInferenceCustomEndpoints<
  T extends { endpoints?: Record<string, unknown> },
>(config: T, env: FreeInferenceEnv | undefined): T {
  const additions = buildFreeInferenceCustomEndpoints(config as FreeInferenceConfigLike, env);
  if (additions.length === 0) {
    return config;
  }
  const endpoints = (config.endpoints ?? {}) as Record<string, unknown>;
  const existing = Array.isArray(endpoints.custom)
    ? (endpoints.custom as Array<{ name?: string }>)
    : [];
  const existingNames = new Set(existing.map((entry) => entry?.name));
  const merged = [...existing, ...additions.filter((entry) => !existingNames.has(entry.name))];
  if (merged.length === existing.length) {
    return config;
  }
  return { ...config, endpoints: { ...endpoints, custom: merged } } as T;
}
