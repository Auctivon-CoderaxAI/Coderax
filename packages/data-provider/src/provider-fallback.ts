/**
 * OpenAI-compatible provider fallback catalog.
 *
 * The credentials stay in the server environment. This module only names the
 * variables and describes the endpoints; it never reads a credential value.
 * The API attaches the other credentialed providers as ordered fallbacks when
 * a turn starts on one of these endpoints.
 *
 * VERCEL_KEY is deliberately absent: it authenticates deployments and must not
 * be sent to an inference gateway. Only the variables named in this catalog may
 * be forwarded as model credentials.
 */

export const PROVIDER_FALLBACK_IDS = [
  'gemini',
  'cerebras',
  'groq',
  'opencode',
  'apinex',
  'cloudflare',
  'freeai',
  '100millionseek',
] as const;

export type ProviderFallbackId = (typeof PROVIDER_FALLBACK_IDS)[number];

export type ProviderFallbackProvider = {
  id: ProviderFallbackId;
  /** Reserved custom-endpoint name. */
  name: string;
  label: string;
  baseURL: string;
  apiKeyEnv: string;
  /** Older names accepted for the same credential, never advertised in place of the canonical one. */
  legacyApiKeyEnv?: readonly string[];
  /** Additional server variables the default endpoint needs (non-secret IDs). */
  requiredEnv?: readonly string[];
  defaultModel: string;
  contextTokens: number;
  /** How, and whether, the provider's usage is proven to remain at $0. */
  zeroCost: {
    status: ProviderZeroCostStatus;
    basis: string;
    /** ISO date of a live verification, or null when the claim is documented but unverified. */
    verifiedAt: string | null;
    evidenceUrl: string;
    note: string;
  };
  /** null means the capability was not verified for this provider. */
  capabilities: {
    streaming: boolean | null;
    tools: boolean | null;
    reasoning: boolean | null;
  };
  /** Work requires verified tool calling, not just an OpenAI-compatible URL. */
  workCompatible: boolean;
};

/**
 * The only status that may pass the default zero-cost gate. Free tiers and
 * trial credits are deliberately excluded: a credential cannot prove which
 * account plan or remaining allowance it belongs to.
 */
export type ProviderZeroCostStatus =
  | 'verified-free-model'
  | 'free-tier-unverified'
  | 'free-allocation-unverified'
  | 'free-allowance-overage'
  | 'free-service-unverified'
  | 'trial-credit'
  | 'requires-topup'
  | 'paid'
  | 'deployment-only';

export const PROVIDER_FALLBACK_PROVIDERS: readonly ProviderFallbackProvider[] = [
  {
    id: 'gemini',
    name: 'Gemini',
    label: 'Google Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKeyEnv: 'GEMINI_API_KEY',
    defaultModel: 'gemini-3.5-flash-lite',
    contextTokens: 1_000_000,
    zeroCost: {
      status: 'free-tier-unverified',
      basis: 'free-tier',
      verifiedAt: null,
      evidenceUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
      note: 'A free tier exists, but the key does not expose the account plan, region or remaining quota.',
    },
    capabilities: { streaming: true, tools: null, reasoning: null },
    workCompatible: false,
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    label: 'Cerebras',
    baseURL: 'https://api.cerebras.ai/v1',
    apiKeyEnv: 'CEREBRAS_API_KEY',
    defaultModel: 'gpt-oss-120b',
    contextTokens: 65_536,
    zeroCost: {
      status: 'trial-credit',
      basis: 'free-trial-credit',
      verifiedAt: null,
      evidenceUrl: 'https://www.cerebras.ai/pricing',
      note: 'The free start is a one-time $5 credit after a verified payment method, not a recurring $0 route.',
    },
    capabilities: { streaming: true, tools: null, reasoning: null },
    workCompatible: false,
  },
  {
    id: 'groq',
    name: 'Groq',
    label: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1',
    apiKeyEnv: 'GROQ_API_KEY',
    defaultModel: 'openai/gpt-oss-120b',
    contextTokens: 32_768,
    zeroCost: {
      status: 'free-tier-unverified',
      basis: 'free-tier',
      verifiedAt: null,
      evidenceUrl: 'https://console.groq.com/docs/billing-faqs',
      note: 'Free and billable Developer tiers share the same key shape, so the account plan cannot be proven.',
    },
    capabilities: { streaming: true, tools: false, reasoning: true },
    workCompatible: false,
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    label: 'OpenCode Zen',
    baseURL: 'https://opencode.ai/zen/v1',
    apiKeyEnv: 'OPENCODEAI_API_KEY',
    defaultModel: 'deepseek-v4.1-flash-free',
    contextTokens: 200_000,
    zeroCost: {
      status: 'paid',
      basis: 'per-request',
      verifiedAt: null,
      evidenceUrl: 'https://opencode.ai/docs/zen',
      note: 'Zen is charged per request; its free-tier chat models require the OpenCode client.',
    },
    capabilities: { streaming: true, tools: null, reasoning: null },
    workCompatible: false,
  },
  {
    id: 'apinex',
    name: 'APInex',
    label: 'APInex',
    baseURL: 'https://api.apinex.bond/v1',
    apiKeyEnv: 'APINEX_KEY',
    defaultModel: 'free/deepseek-v4.1-flash',
    contextTokens: 1_000_000,
    zeroCost: {
      status: 'requires-topup',
      basis: 'free-allowance-after-topup',
      verifiedAt: null,
      evidenceUrl: 'https://apinex.bond/developers/models/connect',
      note: 'The daily free allowance starts after a $5 top-up, so it is not a $0 route.',
    },
    capabilities: { streaming: true, tools: null, reasoning: null },
    workCompatible: false,
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    label: 'Cloudflare Workers AI',
    baseURL: 'https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/v1',
    apiKeyEnv: 'CLOUDFLARE_TOKEN',
    requiredEnv: ['CLOUDFLARE_ACCOUNT_ID'],
    defaultModel: '@cf/openai/gpt-oss-120b',
    contextTokens: 128_000,
    zeroCost: {
      status: 'free-allocation-unverified',
      basis: 'free-daily-allocation',
      verifiedAt: null,
      evidenceUrl: 'https://developers.cloudflare.com/workers-ai/platform/pricing/',
      note: 'The free daily allocation depends on the Workers plan, which the API does not expose.',
    },
    capabilities: { streaming: true, tools: null, reasoning: null },
    workCompatible: false,
  },
  {
    id: 'freeai',
    name: 'FreeAI',
    label: 'Free.ai',
    baseURL: 'https://api.free.ai/v1',
    apiKeyEnv: 'FREEAI_API_KEY',
    defaultModel: 'qwen7b',
    contextTokens: 32_768,
    zeroCost: {
      status: 'free-allowance-overage',
      basis: 'free-daily-allowance',
      verifiedAt: null,
      evidenceUrl: 'https://free.ai/developer',
      note: '30,000 tokens/day are free; self-hosted models bill beyond that pool and the key exposes no remaining allowance.',
    },
    capabilities: { streaming: true, tools: null, reasoning: null },
    workCompatible: false,
  },
  {
    id: '100millionseek',
    name: '100MillionSeek',
    label: '100MillionSeek',
    baseURL: 'https://100milionseek.top/v1',
    apiKeyEnv: 'HMS_API_KEY',
    legacyApiKeyEnv: ['100MILLIONSEEK_API_KEY'],
    defaultModel: 'deepseek-v4.1-flash-free',
    contextTokens: 198_000,
    zeroCost: {
      status: 'free-service-unverified',
      basis: 'free-daily-allowance',
      verifiedAt: null,
      evidenceUrl: 'https://100milionseek.top/docs',
      note: 'The service advertises 100M tokens/day at no charge; no authenticated probe has verified it.',
    },
    capabilities: { streaming: true, tools: true, reasoning: null },
    workCompatible: false,
  },
];

export const DEFAULT_PROVIDER_FALLBACK_ORDER: ProviderFallbackId[] = [...PROVIDER_FALLBACK_IDS];

/** Only a verified $0 model may pass the default gate. */
export function isProviderFallbackZeroCostEligible(provider: ProviderFallbackProvider): boolean {
  return provider.zeroCost.status === 'verified-free-model';
}

export type ProviderFallbackSettings = {
  enabled?: boolean;
  order?: readonly ProviderFallbackId[];
  models?: Partial<Record<ProviderFallbackId, string>>;
  baseURLs?: Partial<Record<ProviderFallbackId, string>>;
  /**
   * Default true. Disabling this permits account-tier providers, which is an
   * explicit owner decision to accept possible charges.
   */
  zeroCostOnly?: boolean;
};

export type ProviderFallbackConfigLike =
  | {
      providerFallback?: ProviderFallbackSettings | null;
      endpoints?: { custom?: unknown } | null;
    }
  | null
  | undefined;

type EndpointConfig = {
  name?: unknown;
  apiKey?: unknown;
  baseURL?: unknown;
  models?: { default?: unknown } | null;
};

function settingsOf(config: ProviderFallbackConfigLike): ProviderFallbackSettings | null {
  return config?.providerFallback ?? null;
}

/** A provider is usable only when the zero-cost gate allows it. */
export function isProviderFallbackAllowed(
  config: ProviderFallbackConfigLike,
  provider: ProviderFallbackProvider,
): boolean {
  return settingsOf(config)?.zeroCostOnly === false || isProviderFallbackZeroCostEligible(provider);
}

export function isProviderFallbackEnabled(config: ProviderFallbackConfigLike): boolean {
  return settingsOf(config)?.enabled === true;
}

export function providerFallbackForEndpoint(name: unknown): ProviderFallbackProvider | null {
  if (typeof name !== 'string') {
    return null;
  }
  return (
    PROVIDER_FALLBACK_PROVIDERS.find(
      (provider) => provider.name.toLowerCase() === name.trim().toLowerCase(),
    ) ?? null
  );
}

export function providerFallbackModel(
  config: ProviderFallbackConfigLike,
  provider: ProviderFallbackProvider,
): string {
  const configured = settingsOf(config)?.models?.[provider.id];
  return typeof configured === 'string' && configured.trim() !== ''
    ? configured.trim()
    : provider.defaultModel;
}

export function providerFallbackBaseURL(
  config: ProviderFallbackConfigLike,
  provider: ProviderFallbackProvider,
): string {
  const configured = settingsOf(config)?.baseURLs?.[provider.id];
  return typeof configured === 'string' && configured.trim() !== ''
    ? configured.trim().replace(/\/$/, '')
    : provider.baseURL;
}

/**
 * Provider order for a turn. The selected endpoint is always first, then the
 * operator's configured order, with duplicates removed.
 */
export function providerFallbackOrder(
  config: ProviderFallbackConfigLike,
  start?: ProviderFallbackId,
): ProviderFallbackProvider[] {
  const configured = settingsOf(config)?.order ?? DEFAULT_PROVIDER_FALLBACK_ORDER;
  const ids = [start, ...configured].filter(
    (id): id is ProviderFallbackId => typeof id === 'string',
  );
  const seen = new Set<ProviderFallbackId>();
  const providers: ProviderFallbackProvider[] = [];
  for (const id of ids) {
    if (seen.has(id)) {
      continue;
    }
    const provider = PROVIDER_FALLBACK_PROVIDERS.find((entry) => entry.id === id);
    if (!provider) {
      continue;
    }
    seen.add(id);
    providers.push(provider);
  }
  return providers;
}

export function providerFallbackEndpointMatches(
  endpoint: EndpointConfig | null | undefined,
  provider: ProviderFallbackProvider,
  config: ProviderFallbackConfigLike,
): boolean {
  if (!endpoint) {
    return false;
  }
  const models = endpoint.models?.default;
  return (
    endpoint.name === provider.name &&
    endpoint.baseURL === providerFallbackBaseURL(config, provider) &&
    endpoint.apiKey === '${' + provider.apiKeyEnv + '}' &&
    Array.isArray(models) &&
    models.includes(providerFallbackModel(config, provider))
  );
}

function hasCredential(
  env: Record<string, string | undefined> | undefined,
  provider: ProviderFallbackProvider,
): boolean {
  const credential = [provider.apiKeyEnv, ...(provider.legacyApiKeyEnv ?? [])].some((name) =>
    Boolean(env?.[name]),
  );
  return credential && (provider.requiredEnv ?? []).every((name) => Boolean(env?.[name]));
}

export type ProviderFallbackEndpoint = {
  name: string;
  baseURL: string;
  apiKey: string;
  modelDisplayLabel: string;
  models: { default: string[] };
  titleConvo: false;
};

export function buildProviderFallbackCustomEndpoints(
  config: ProviderFallbackConfigLike,
  env: Record<string, string | undefined> | undefined,
): ProviderFallbackEndpoint[] {
  if (!isProviderFallbackEnabled(config)) {
    return [];
  }
  return PROVIDER_FALLBACK_PROVIDERS.filter(
    (provider) => isProviderFallbackAllowed(config, provider) && hasCredential(env, provider),
  ).map((provider) => ({
    name: provider.name,
    baseURL: providerFallbackBaseURL(config, provider),
    apiKey: '${' + provider.apiKeyEnv + '}',
    modelDisplayLabel: provider.label,
    models: { default: [providerFallbackModel(config, provider)] },
    titleConvo: false,
  }));
}

/**
 * Merge credentialed fallback providers into a deployment config as ordinary
 * OpenAI-compatible custom endpoints. Existing names win, so an operator's
 * endpoint is never replaced or silently relabeled.
 */
export function mergeProviderFallbackCustomEndpoints<
  T extends { endpoints?: Record<string, unknown> | null },
>(config: T, env: Record<string, string | undefined> | undefined): T {
  const additions = buildProviderFallbackCustomEndpoints(config as ProviderFallbackConfigLike, env);
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
