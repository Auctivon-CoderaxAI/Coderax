/**
 * Dynamic provider and model catalog.
 *
 * Providers publish different model shapes, so discovery is split into an
 * adapter per API contract, then normalized once. Registration, credential
 * state, discovery, visibility, zero-cost eligibility, Chat compatibility and
 * Work compatibility stay separate: a provider with no credential is still
 * listed, and a discovered model is still visible when it is not executable.
 *
 * Credentials are never read here. Callers pass an environment lookup and the
 * normalized catalog only records which variable was found.
 */

export const CATALOG_PROVIDER_IDS = [
  'openrouter',
  'gemini',
  'cerebras',
  'groq',
  'opencodeai',
  'apinex',
  'freeai',
  '100millionseek',
] as const;

export type CatalogProviderId = (typeof CATALOG_PROVIDER_IDS)[number];

/** How a provider's catalog is parsed. */
export type CatalogAdapter = 'openai' | 'gemini';

export type CatalogProvider = {
  id: CatalogProviderId;
  label: string;
  /** Inference base URL, exposed to the OpenAI-compatible endpoint client. */
  baseURL: string;
  /** Model catalog endpoint. */
  modelsURL: string;
  adapter: CatalogAdapter;
  auth: 'bearer' | 'x-goog-api-key';
  /** Canonical credential variable. */
  apiKeyEnv: string;
  /** Accepted older names for the same credential, canonical first. */
  legacyApiKeyEnv: readonly string[];
  /** Additional non-secret server variables the endpoint needs. */
  requiredEnv: readonly string[];
  docsURL: string;
  /** How prices are published, which bounds what eligibility can be proven. */
  pricing: 'per-model' | 'account-plan';
  /**
   * Why a published $0 price does or does not prove a $0 route: a `:free`
   * model is free per request, a metered allowance bills past a daily pool,
   * and an account plan cannot be proven from a credential.
   */
  zeroCost: 'free-model' | 'metered-allowance' | 'account-plan';
};

export const CATALOG_PROVIDERS: readonly CatalogProvider[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    modelsURL: 'https://openrouter.ai/api/v1/models?output_modalities=all',
    adapter: 'openai',
    auth: 'bearer',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    legacyApiKeyEnv: [],
    requiredEnv: [],
    docsURL: 'https://openrouter.ai/docs/api-reference/list-available-models',
    pricing: 'per-model',
    zeroCost: 'free-model',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    modelsURL: 'https://generativelanguage.googleapis.com/v1beta/models',
    adapter: 'gemini',
    auth: 'x-goog-api-key',
    apiKeyEnv: 'GEMINI_API_KEY',
    legacyApiKeyEnv: [],
    requiredEnv: [],
    docsURL: 'https://ai.google.dev/gemini-api/docs/models',
    pricing: 'account-plan',
    zeroCost: 'account-plan',
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    baseURL: 'https://api.cerebras.ai/v1',
    modelsURL: 'https://api.cerebras.ai/v1/models',
    adapter: 'openai',
    auth: 'bearer',
    apiKeyEnv: 'CEREBRAS_API_KEY',
    legacyApiKeyEnv: [],
    requiredEnv: [],
    docsURL: 'https://inference-docs.cerebras.ai/models/overview',
    pricing: 'account-plan',
    zeroCost: 'account-plan',
  },
  {
    id: 'groq',
    label: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1',
    modelsURL: 'https://api.groq.com/openai/v1/models',
    adapter: 'openai',
    auth: 'bearer',
    apiKeyEnv: 'GROQ_API_KEY',
    legacyApiKeyEnv: [],
    requiredEnv: [],
    docsURL: 'https://console.groq.com/docs/models',
    pricing: 'account-plan',
    zeroCost: 'account-plan',
  },
  {
    id: 'opencodeai',
    label: 'OpenCode Zen',
    baseURL: 'https://opencode.ai/zen/v1',
    modelsURL: 'https://opencode.ai/zen/v1/models',
    adapter: 'openai',
    auth: 'bearer',
    apiKeyEnv: 'OPENCODEAI_API_KEY',
    legacyApiKeyEnv: [],
    requiredEnv: [],
    docsURL: 'https://opencode.ai/docs/zen',
    pricing: 'account-plan',
    zeroCost: 'account-plan',
  },
  {
    id: 'apinex',
    label: 'APInex',
    baseURL: 'https://api.apinex.bond/v1',
    modelsURL: 'https://api.apinex.bond/v1/models',
    adapter: 'openai',
    auth: 'bearer',
    apiKeyEnv: 'APINEX_KEY',
    legacyApiKeyEnv: [],
    requiredEnv: [],
    docsURL: 'https://apinex.bond/developers/models/chat',
    pricing: 'account-plan',
    zeroCost: 'account-plan',
  },
  {
    id: 'freeai',
    label: 'Free.ai',
    baseURL: 'https://api.free.ai/v1',
    modelsURL: 'https://api.free.ai/v1/models',
    adapter: 'openai',
    auth: 'bearer',
    apiKeyEnv: 'FREEAI_API_KEY',
    legacyApiKeyEnv: [],
    requiredEnv: [],
    docsURL: 'https://free.ai/api/',
    pricing: 'per-model',
    // 30,000 tokens/day are free; self-hosted models bill beyond that pool.
    zeroCost: 'metered-allowance',
  },
  {
    id: '100millionseek',
    label: '100MillionSeek',
    baseURL: 'https://100milionseek.top/v1',
    modelsURL: 'https://100milionseek.top/v1/models',
    adapter: 'openai',
    auth: 'bearer',
    apiKeyEnv: 'HMS_API_KEY',
    legacyApiKeyEnv: ['100MILLIONSEEK_API_KEY'],
    requiredEnv: [],
    docsURL: 'https://100milionseek.top/docs',
    pricing: 'account-plan',
    zeroCost: 'account-plan',
  },
];

export type CatalogEnv = Record<string, string | undefined>;

export type ProviderCredentialState = {
  status: 'present' | 'missing';
  /** The variable that supplied the credential, canonical first. */
  env: string | null;
  /** True when only a legacy alias was found. */
  legacy: boolean;
};

export type CatalogModelCapabilities = {
  streaming: boolean | null;
  reasoning: boolean | null;
  tools: boolean | null;
  structuredOutputs: boolean | null;
};

export type CatalogModelPricing = {
  /** Published price per token, when the catalog exposes one. */
  promptPerToken: number | null;
  completionPerToken: number | null;
  /** Every published price is zero; `null` when the catalog publishes none. */
  free: boolean | null;
  basis: 'per-model' | 'account-plan' | 'unknown';
};

export type ModelAvailabilityReason =
  | 'available'
  | 'credential_missing'
  | 'credential_rejected'
  | 'provider_unreachable'
  | 'model_inactive'
  | 'nonzero_price'
  | 'pricing_unverified'
  | 'account_allowance_unverified';

export type CatalogModel = {
  provider: CatalogProviderId;
  providerLabel: string;
  /** Exact identifier the provider expects in a request. */
  id: string;
  label: string;
  contextTokens: number | null;
  pricing: CatalogModelPricing;
  capabilities: CatalogModelCapabilities;
  /** Chat compatibility: an executable HTTP route exists and the model is eligible. */
  chat: boolean;
  /** Work compatibility: Chat compatibility plus verified native tool calling. */
  work: boolean;
  available: boolean;
  reason: ModelAvailabilityReason;
  sourceURL: string;
  discoveredAt: string;
};

export type ProviderDiscoveryState = {
  provider: CatalogProviderId;
  label: string;
  credential: ProviderCredentialState;
  status: 'ok' | 'credential_missing' | 'credential_rejected' | 'provider_unreachable';
  httpStatus: number | null;
  error: string | null;
  modelCount: number;
  discoveredAt: string | null;
};

export type CatalogSnapshot = {
  generatedAt: string;
  providers: ProviderDiscoveryState[];
  models: CatalogModel[];
  counts: {
    providers: number;
    discoveredProviders: number;
    models: number;
    availableModels: number;
    workModels: number;
  };
};

export type CatalogFetch = (
  input: string,
  init: { headers: Record<string, string>; signal?: AbortSignal },
) => Promise<{ status: number; ok: boolean; json: () => Promise<unknown> }>;

type RawRecord = Record<string, unknown>;

function asRecord(value: unknown): RawRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as RawRecord)
    : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

/** Resolve the canonical credential name, falling back to a legacy alias. */
export function resolveProviderCredential(
  provider: CatalogProvider,
  env: CatalogEnv | undefined,
): ProviderCredentialState {
  for (const name of [provider.apiKeyEnv, ...provider.legacyApiKeyEnv]) {
    if (env?.[name]) {
      return { status: 'present', env: name, legacy: name !== provider.apiKeyEnv };
    }
  }
  return { status: 'missing', env: null, legacy: false };
}

function capabilityFromParameters(parameters: readonly string[], names: readonly string[]) {
  if (parameters.length === 0) {
    return null;
  }
  return names.some((name) => parameters.includes(name));
}

/** OpenRouter publishes supported request parameters per model. */
function openRouterCapabilities(raw: RawRecord): CatalogModelCapabilities {
  const parameters = asStringArray(raw.supported_parameters);
  return {
    streaming: true,
    reasoning:
      capabilityFromParameters(parameters, ['reasoning', 'include_reasoning']) ??
      (asRecord(raw.reasoning) ? true : null),
    tools: capabilityFromParameters(parameters, ['tools', 'tool_choice']),
    structuredOutputs: capabilityFromParameters(parameters, [
      'response_format',
      'structured_outputs',
    ]),
  };
}

/** Groq exposes modalities but not tool or response-format support per model. */
function modalityCapabilities(raw: RawRecord): CatalogModelCapabilities {
  const input = asStringArray(raw.input_modalities);
  const output = asStringArray(raw.output_modalities);
  const text = input.length === 0 || (input.includes('text') && output.includes('text'));
  return {
    streaming: true,
    reasoning: null,
    tools: null,
    structuredOutputs: text ? null : false,
  };
}

// OpenRouter publishes these charge dimensions separately from token pricing.
const OPENROUTER_EXTRA_PRICES = [
  'request',
  'image',
  'image_output',
  'image_token',
  'audio',
  'audio_output',
  'input_audio_cache',
  'input_cache_read',
  'input_cache_write',
  'input_cache_write_1h',
  'internal_reasoning',
  'web_search',
] as const;

function openRouterExtraPrices(pricing: RawRecord): (number | null)[] {
  const prices = OPENROUTER_EXTRA_PRICES.filter((key) => key in pricing).map((key) =>
    asNumber(pricing[key]),
  );
  if ('overrides' in pricing) {
    if (!Array.isArray(pricing.overrides)) {
      prices.push(null);
    } else {
      for (const override of pricing.overrides) {
        const entry = asRecord(override);
        if (!entry) {
          prices.push(null);
          continue;
        }
        for (const key of ['prompt', 'completion', ...OPENROUTER_EXTRA_PRICES]) {
          if (key in entry) prices.push(asNumber(entry[key]));
        }
      }
    }
  }
  return prices;
}

function normalizePricing(provider: CatalogProvider, raw: RawRecord): CatalogModelPricing {
  const pricing = asRecord(raw.pricing);
  if (provider.pricing === 'per-model' && pricing) {
    const prompt = asNumber(pricing.prompt);
    const completion = asNumber(pricing.completion);
    const prices = [
      prompt,
      completion,
      ...(provider.id === 'openrouter' ? openRouterExtraPrices(pricing) : []),
    ];
    let free: boolean | null = null;
    if (prices.some((price) => price !== null && price !== 0)) {
      free = false;
    } else if (prices.every((price) => price === 0)) {
      free = true;
    }
    return { promptPerToken: prompt, completionPerToken: completion, free, basis: 'per-model' };
  }
  return {
    promptPerToken: null,
    completionPerToken: null,
    free: null,
    basis: provider.pricing === 'account-plan' ? 'account-plan' : 'unknown',
  };
}

/**
 * Eligibility is evaluated per model, not per provider:
 *
 * 1. A model the provider reports inactive is never executable.
 * 2. A published nonzero price disqualifies it outright.
 * 3. A metered allowance or an account-plan provider keeps the model visible
 *    but disabled: neither a price list nor a credential proves the route is $0.
 * 4. Only an explicit per-model free price on a free-model provider passes.
 */
export function evaluateModelAvailability(
  provider: CatalogProvider,
  pricing: CatalogModelPricing,
  credential: ProviderCredentialState,
  active: boolean,
): { available: boolean; reason: ModelAvailabilityReason } {
  if (credential.status === 'missing') {
    return { available: false, reason: 'credential_missing' };
  }
  if (!active) {
    return { available: false, reason: 'model_inactive' };
  }
  if (pricing.free === false) {
    return { available: false, reason: 'nonzero_price' };
  }
  if (provider.zeroCost !== 'free-model') {
    return { available: false, reason: 'account_allowance_unverified' };
  }
  if (pricing.free === null) {
    return { available: false, reason: 'pricing_unverified' };
  }
  return { available: true, reason: 'available' };
}

function modelList(provider: CatalogProvider, body: RawRecord | null): unknown[] | null {
  const list = provider.adapter === 'gemini' ? body?.models : body?.data;
  return Array.isArray(list) ? list : null;
}

function modelId(provider: CatalogProvider, raw: RawRecord): string | null {
  const id = asString(raw.id);
  if (id) {
    return provider.adapter === 'gemini' ? id.replace(/^models\//, '') : id;
  }
  const name = asString(raw.name);
  return provider.adapter === 'gemini' && name ? name.replace(/^models\//, '') : null;
}

function modelLabel(provider: CatalogProvider, raw: RawRecord, id: string): string {
  // Gemini's `name` is the identifier; its human label is `displayName`.
  if (provider.adapter === 'gemini') {
    return asString(raw.displayName) ?? asString(raw.name) ?? id;
  }
  return asString(raw.name) ?? asString(raw.displayName) ?? id;
}

function modelContext(raw: RawRecord): number | null {
  return (
    asNumber(raw.context_length) ??
    asNumber(raw.context_window) ??
    asNumber(raw.inputTokenLimit) ??
    asNumber(asRecord(raw.top_provider)?.context_length)
  );
}

/** Provider-specific fields not covered by capabilities or pricing. */
function isActive(raw: RawRecord): boolean {
  return raw.active === false ? false : true;
}

/** Normalize one provider payload into the shared model shape. */
export function normalizeProviderModels(
  provider: CatalogProvider,
  payload: unknown,
  credential: ProviderCredentialState,
  discoveredAt: string,
): CatalogModel[] {
  return normalizeModelList(
    provider,
    modelList(provider, asRecord(payload)) ?? [],
    credential,
    discoveredAt,
  );
}

function normalizeModelList(
  provider: CatalogProvider,
  list: unknown[],
  credential: ProviderCredentialState,
  discoveredAt: string,
): CatalogModel[] {
  const models: CatalogModel[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    const raw = asRecord(entry);
    if (!raw) continue;
    const id = modelId(provider, raw);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const capabilities =
      provider.id === 'openrouter' ? openRouterCapabilities(raw) : modalityCapabilities(raw);
    const pricing = normalizePricing(provider, raw);
    const { available, reason } = evaluateModelAvailability(
      provider,
      pricing,
      credential,
      isActive(raw),
    );
    const chat =
      available &&
      (provider.id !== 'openrouter' ||
        (asStringArray(asRecord(raw.architecture)?.input_modalities).includes('text') &&
          asStringArray(raw.endpoints).includes('/api/v1/chat/completions')));
    models.push({
      provider: provider.id,
      providerLabel: provider.label,
      id,
      label: modelLabel(provider, raw, id),
      contextTokens: modelContext(raw),
      pricing,
      capabilities,
      available,
      reason,
      chat,
      work: chat && capabilities.tools === true,
      sourceURL: provider.docsURL,
      discoveredAt,
    });
  }
  return models;
}

/** Map a discovery failure to the status the selector displays. */
function discoveryStatusFor(
  credential: ProviderCredentialState,
  httpStatus: number | null,
): ProviderDiscoveryState['status'] {
  if (credential.status === 'missing') {
    return 'credential_missing';
  }
  if (httpStatus === 401 || httpStatus === 403) {
    return 'credential_rejected';
  }
  return 'provider_unreachable';
}

export type DiscoverProviderOptions = {
  env?: CatalogEnv;
  fetch: CatalogFetch;
  now?: () => Date;
  timeoutMs?: number;
};

/** Discover one provider's catalog, preserving its state even on failure. */
export async function discoverProviderModels(
  provider: CatalogProvider,
  options: DiscoverProviderOptions,
): Promise<{ state: ProviderDiscoveryState; models: CatalogModel[] }> {
  const now = options.now ?? (() => new Date());
  const discoveredAt = now().toISOString();
  const credential = resolveProviderCredential(provider, options.env);
  const base: ProviderDiscoveryState = {
    provider: provider.id,
    label: provider.label,
    credential,
    status: 'credential_missing',
    httpStatus: null,
    error: null,
    modelCount: 0,
    discoveredAt: null,
  };
  if (credential.status === 'missing') {
    return { state: base, models: [] };
  }
  const required = provider.requiredEnv.filter((name) => !options.env?.[name]);
  if (required.length > 0) {
    return {
      state: { ...base, status: 'provider_unreachable', error: `missing ${required.join(', ')}` },
      models: [],
    };
  }
  const credentialValue = options.env?.[credential.env ?? ''];
  const headers: Record<string, string> = {
    accept: 'application/json',
    ...(provider.auth === 'x-goog-api-key'
      ? { 'x-goog-api-key': credentialValue ?? '' }
      : { authorization: `Bearer ${credentialValue ?? ''}` }),
  };
  try {
    const signal = AbortSignal.timeout(options.timeoutMs ?? 20_000);
    const rows: unknown[] = [];
    const seenTokens = new Set<string>();
    let url = provider.modelsURL;
    while (true) {
      const response = await options.fetch(url, { headers, signal });
      if (!response.ok) {
        return {
          state: {
            ...base,
            status: discoveryStatusFor(credential, response.status),
            httpStatus: response.status,
            error: `HTTP ${response.status}`,
          },
          models: [],
        };
      }
      const body = asRecord(await response.json());
      const page = modelList(provider, body);
      const token = provider.adapter === 'gemini' ? body?.nextPageToken : undefined;
      if (page === null || (token !== undefined && typeof token !== 'string')) {
        return {
          state: {
            ...base,
            status: 'provider_unreachable',
            httpStatus: response.status,
            error: 'invalid model catalog response',
          },
          models: [],
        };
      }
      for (const row of page) rows.push(row);
      if (!token) {
        const models = normalizeModelList(provider, rows, credential, discoveredAt);
        return {
          state: {
            ...base,
            status: 'ok',
            httpStatus: response.status,
            modelCount: models.length,
            discoveredAt,
          },
          models,
        };
      }
      if (seenTokens.has(token)) {
        throw new Error('repeated model catalog page token');
      }
      seenTokens.add(token);
      const nextURL = new URL(provider.modelsURL);
      nextURL.searchParams.set('pageToken', token);
      url = nextURL.toString();
    }
  } catch (error) {
    return {
      state: {
        ...base,
        status: 'provider_unreachable',
        error: error instanceof Error ? error.message : 'discovery failed',
      },
      models: [],
    };
  }
}

export type DiscoverCatalogOptions = {
  env?: CatalogEnv;
  fetch?: CatalogFetch;
  now?: () => Date;
  providers?: readonly CatalogProvider[];
  timeoutMs?: number;
};

/** Discover every registered provider in parallel, keeping failures as state. */
export async function discoverCatalog(
  options: DiscoverCatalogOptions = {},
): Promise<CatalogSnapshot> {
  const providers = options.providers ?? CATALOG_PROVIDERS;
  const fetchImpl =
    options.fetch ?? ((input, init) => fetch(input, init) as unknown as ReturnType<CatalogFetch>);
  const results = await Promise.all(
    providers.map((provider) =>
      discoverProviderModels(provider, {
        env: options.env,
        fetch: fetchImpl,
        now: options.now,
        timeoutMs: options.timeoutMs,
      }),
    ),
  );
  const models = results.flatMap((result) => result.models);
  const available = models.filter((model) => model.available);
  const now = options.now ?? (() => new Date());
  return {
    generatedAt: now().toISOString(),
    providers: results.map((result) => result.state),
    models,
    counts: {
      providers: providers.length,
      discoveredProviders: results.filter((result) => result.state.status === 'ok').length,
      models: models.length,
      availableModels: available.length,
      workModels: available.filter((model) => model.work).length,
    },
  };
}

/** Identifier used for deduplication and preference matching. */
export function modelKey(model: Pick<CatalogModel, 'provider' | 'id'>): string {
  return `${model.provider}:${model.id}`;
}

export function dedupeModels(models: readonly CatalogModel[]): CatalogModel[] {
  const seen = new Set<string>();
  const unique: CatalogModel[] = [];
  for (const model of models) {
    const key = modelKey(model);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(model);
    }
  }
  return unique;
}

export function searchModels(models: readonly CatalogModel[], query: string): CatalogModel[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return [...models];
  }
  return models.filter(
    (model) =>
      model.id.toLowerCase().includes(needle) ||
      model.label.toLowerCase().includes(needle) ||
      model.providerLabel.toLowerCase().includes(needle),
  );
}

export type CatalogFilter = {
  provider?: CatalogProviderId;
  mode?: 'chat' | 'work';
  availableOnly?: boolean;
  requiresTools?: boolean;
  minContextTokens?: number;
};

export function filterModels(
  models: readonly CatalogModel[],
  filter: CatalogFilter = {},
): CatalogModel[] {
  return models.filter((model) => {
    if (filter.provider && model.provider !== filter.provider) return false;
    if (filter.availableOnly && !model.available) return false;
    if (filter.requiresTools && model.capabilities.tools !== true) return false;
    if (filter.minContextTokens != null && (model.contextTokens ?? 0) < filter.minContextTokens) {
      return false;
    }
    if (filter.mode === 'chat' && !model.chat) return false;
    if (filter.mode === 'work' && !model.work) return false;
    return true;
  });
}

export type ProviderHealth = {
  failures: number;
  cooldownUntil: number | null;
  lastError: string | null;
};

/** Short exponential cooldown so one failing provider cannot stall a turn. */
export class ProviderHealthTracker {
  private readonly states = new Map<CatalogProviderId, ProviderHealth>();

  state(provider: CatalogProviderId): ProviderHealth {
    return this.states.get(provider) ?? { failures: 0, cooldownUntil: null, lastError: null };
  }

  recordSuccess(provider: CatalogProviderId): void {
    this.states.set(provider, { failures: 0, cooldownUntil: null, lastError: null });
  }

  recordFailure(provider: CatalogProviderId, error: string, now: number, baseMs = 30_000): void {
    const previous = this.state(provider);
    const failures = previous.failures + 1;
    const cooldown = Math.min(baseMs * 2 ** (failures - 1), 15 * 60_000);
    this.states.set(provider, { failures, cooldownUntil: now + cooldown, lastError: error });
  }

  isAvailable(provider: CatalogProviderId, now: number): boolean {
    const cooldown = this.state(provider).cooldownUntil;
    return cooldown === null || cooldown <= now;
  }
}

export type QuotaWindow = { limit: number; used: number; resetAt: number };

/** Per-provider request budget, reset on a fixed UTC-day boundary. */
export class ProviderQuotaLedger {
  private readonly usage = new Map<string, number>();

  private key(provider: CatalogProviderId, now: number): string {
    return `${provider}:${Math.floor(now / 86_400_000)}`;
  }

  window(provider: CatalogProviderId, now: number, limit: number): QuotaWindow {
    return {
      limit,
      used: this.usage.get(this.key(provider, now)) ?? 0,
      resetAt: (Math.floor(now / 86_400_000) + 1) * 86_400_000,
    };
  }

  remaining(provider: CatalogProviderId, now: number, limit: number): number {
    const window = this.window(provider, now, limit);
    return Math.max(0, window.limit - window.used);
  }

  consume(provider: CatalogProviderId, now: number, limit: number, requests = 1): boolean {
    if (!Number.isSafeInteger(requests) || requests < 0) return false;
    const window = this.window(provider, now, limit);
    if (window.used + requests > window.limit) {
      return false;
    }
    this.usage.set(this.key(provider, now), window.used + requests);
    return true;
  }
}

export type FallbackOptions = {
  mode: 'chat' | 'work';
  now?: number;
  preferredModelId?: string;
  providerOrder?: readonly CatalogProviderId[];
  providerLimits?: Partial<Record<CatalogProviderId, number>>;
  health?: ProviderHealthTracker;
  quota?: ProviderQuotaLedger;
  exclude?: readonly string[];
};

/**
 * Ordered zero-cost routes for one turn: available models only, healthy
 * providers first, quota respected, and the owner's preferred model first when
 * it is genuinely eligible.
 */
export function planModelFallback(
  models: readonly CatalogModel[],
  options: FallbackOptions,
): CatalogModel[] {
  const now = options.now ?? Date.now();
  const excluded = new Set(options.exclude ?? []);
  const order = options.providerOrder ?? CATALOG_PROVIDER_IDS;
  const rank = new Map<CatalogProviderId, number>(order.map((id, index) => [id, index]));
  const candidates = models.filter((model) => {
    if (!model.available) return false;
    if (options.mode === 'work' ? !model.work : !model.chat) return false;
    if (excluded.has(modelKey(model))) return false;
    if (options.health && !options.health.isAvailable(model.provider, now)) return false;
    const limit = options.providerLimits?.[model.provider];
    if (
      limit != null &&
      (limit <= 0 || (options.quota && options.quota.remaining(model.provider, now, limit) <= 0))
    ) {
      return false;
    }
    return true;
  });
  const preferred = options.preferredModelId;
  return [...candidates].sort((a, b) => {
    const aPreferred = preferred != null && (a.id === preferred || modelKey(a) === preferred);
    const bPreferred = preferred != null && (b.id === preferred || modelKey(b) === preferred);
    if (aPreferred !== bPreferred) return aPreferred ? -1 : 1;
    const providerDelta = (rank.get(a.provider) ?? 99) - (rank.get(b.provider) ?? 99);
    if (providerDelta !== 0) return providerDelta;
    const aContext = a.contextTokens ?? 0;
    const bContext = b.contextTokens ?? 0;
    if (aContext !== bContext) return bContext - aContext;
    return a.id.localeCompare(b.id);
  });
}

export type CatalogCacheOptions = {
  ttlMs?: number;
  now?: () => number;
  discover?: (options: DiscoverCatalogOptions) => Promise<CatalogSnapshot>;
  env?: CatalogEnv;
  fetch?: CatalogFetch;
};

/**
 * Cached catalog with refresh-on-read. Concurrent readers share one in-flight
 * discovery, and a failed refresh keeps the last good snapshot.
 */
export class ModelCatalog {
  private snapshot: CatalogSnapshot | null = null;
  private refreshedAt: number | null = null;
  private inFlight: Promise<CatalogSnapshot> | null = null;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly discover: (options: DiscoverCatalogOptions) => Promise<CatalogSnapshot>;

  constructor(private readonly options: CatalogCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? 10 * 60_000;
    this.now = options.now ?? (() => Date.now());
    this.discover = options.discover ?? discoverCatalog;
  }

  current(): CatalogSnapshot | null {
    return this.snapshot;
  }

  isStale(): boolean {
    return this.refreshedAt === null || this.now() - this.refreshedAt >= this.ttlMs;
  }

  async refresh(): Promise<CatalogSnapshot> {
    if (this.inFlight) {
      return this.inFlight;
    }
    this.inFlight = this.discover({
      env: this.options.env,
      fetch: this.options.fetch,
      now: () => new Date(this.now()),
    })
      .then((snapshot) => {
        const failures = new Map(
          snapshot.providers.flatMap(({ provider, status }) =>
            status === 'credential_rejected' || status === 'provider_unreachable'
              ? [[provider, status] as const]
              : [],
          ),
        );
        if (failures.size === 0) {
          this.snapshot = snapshot;
          this.refreshedAt = this.now();
          return snapshot;
        }
        return this.retainFailedModels(snapshot, failures);
      })
      .catch((error: unknown) => {
        if (this.snapshot) {
          const previous = this.snapshot;
          const failures = new Map<CatalogProviderId, 'provider_unreachable'>();
          for (const { provider } of previous.models)
            failures.set(provider, 'provider_unreachable');
          const providers = previous.providers.map(
            (state): ProviderDiscoveryState =>
              state.status === 'credential_missing'
                ? state
                : {
                    ...state,
                    status: 'provider_unreachable',
                    httpStatus: null,
                    error: null,
                    modelCount: 0,
                    discoveredAt: null,
                  },
          );
          return this.retainFailedModels(
            {
              ...previous,
              providers,
              models: [],
              counts: {
                ...previous.counts,
                discoveredProviders: 0,
                availableModels: 0,
                workModels: 0,
              },
            },
            failures,
          );
        }
        throw error;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  private retainFailedModels(
    snapshot: CatalogSnapshot,
    failures: ReadonlyMap<CatalogProviderId, 'credential_rejected' | 'provider_unreachable'>,
  ): CatalogSnapshot {
    const retained = (this.snapshot?.models ?? []).flatMap((model) => {
      const reason = failures.get(model.provider);
      return reason ? [{ ...model, available: false, chat: false, work: false, reason }] : [];
    });
    const models = [...snapshot.models, ...retained];
    this.snapshot = {
      ...snapshot,
      generatedAt:
        snapshot.counts.discoveredProviders === 0
          ? (this.snapshot?.generatedAt ?? snapshot.generatedAt)
          : snapshot.generatedAt,
      models,
      counts: { ...snapshot.counts, models: models.length },
    };
    this.refreshedAt = null;
    return this.snapshot;
  }

  async ensureFresh(): Promise<CatalogSnapshot> {
    return this.inFlight ?? (this.isStale() ? this.refresh() : (this.snapshot as CatalogSnapshot));
  }
}
