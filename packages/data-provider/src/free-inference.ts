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
  /** A non-zero rate here would make the endpoint chargeable and is rejected. */
  promptCostPerMillion?: number;
  completionCostPerMillion?: number;
};

export type FreeEndpointRejection =
  | 'unknown_provider'
  | 'unverified_pricing'
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

/** Providers Coderax will route to. Anything else is rejected, not disabled. */
export const FREE_PROVIDER_ALLOWLIST: readonly FreeProviderId[] = [
  'openrouter',
  'groq',
  'cloudflare',
];

/**
 * Verified fallbacks, best first. `routingPriority` is an operator preference
 * between models of similar capability, not a benchmark result.
 */
export const FREE_ENDPOINTS: readonly FreeEndpoint[] = [
  {
    id: 'openrouter-nemotron-ultra-free',
    provider: 'openrouter',
    modelId: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    label: 'NVIDIA Nemotron 3 Ultra (free)',
    kind: 'fallback',
    baseURL: 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    pricing: {
      basis: 'free-model',
      verifiedAt: '2026-11-08',
      evidenceUrl: 'https://openrouter.ai/api/v1/models',
      note: 'The :free variant is listed with prompt and completion price 0.',
    },
    capabilities: { streaming: true, tools: true, reasoning: true },
    contextTokens: 1_000_000,
    routingPriority: 10,
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
      verifiedAt: '2026-11-08',
      evidenceUrl: 'https://console.groq.com/docs/rate-limits',
      note: 'Base plan rate limits (30 RPM, 1K RPD, 8K TPM, 200K TPD) with no per-token charge.',
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
    baseURL: 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    pricing: {
      basis: 'free-model',
      verifiedAt: '2026-11-08',
      evidenceUrl: 'https://openrouter.ai/api/v1/models',
      note: 'The :free variant is listed with prompt and completion price 0.',
    },
    capabilities: { streaming: true, tools: true, reasoning: true },
    contextTokens: 1_000_000,
    routingPriority: 30,
  },
  {
    id: 'cloudflare-llama-3-3-70b-free',
    provider: 'cloudflare',
    modelId: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    label: 'Llama 3.3 70B on Workers AI',
    kind: 'fallback',
    baseURL: 'https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run',
    apiKeyEnv: 'CLOUDFLARE_API_TOKEN',
    pricing: {
      basis: 'free-daily-allocation',
      verifiedAt: '2026-11-08',
      evidenceUrl: 'https://developers.cloudflare.com/workers-ai/platform/pricing/',
      note: '10,000 Neurons per day are included; usage above the allocation fails instead of billing on the Workers Free plan.',
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
    baseURL: 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    pricing: {
      basis: 'free-model',
      verifiedAt: '2026-11-08',
      evidenceUrl: 'https://openrouter.ai/api/v1/models',
      note: 'The :free variant is listed with prompt and completion price 0.',
    },
    capabilities: { streaming: true, tools: true, reasoning: true },
    contextTokens: 262_144,
    routingPriority: 50,
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
  if (!FREE_PROVIDER_ALLOWLIST.includes(endpoint.provider)) {
    return { ok: false, reason: 'unknown_provider' };
  }
  if (
    !isAbsoluteHttpUrl(endpoint.pricing.evidenceUrl) ||
    endpoint.pricing.verifiedAt.trim() === ''
  ) {
    return { ok: false, reason: 'unverified_pricing' };
  }
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
