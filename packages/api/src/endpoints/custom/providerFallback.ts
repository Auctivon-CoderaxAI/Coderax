import { Providers } from '@librechat/agents';
import {
  extractEnvVariable,
  isProviderFallbackAllowed,
  isProviderFallbackEnabled,
  providerFallbackBaseURL,
  providerFallbackEndpointMatches,
  providerFallbackForEndpoint,
  providerFallbackModel,
  providerFallbackOrder,
} from 'coderax-data-provider';
import type {
  CatalogSnapshot,
  ProviderFallbackConfigLike,
  ProviderFallbackProvider,
  TEndpoint,
} from 'coderax-data-provider';
import type { FallbackConfig, OpenAIClientOptions } from '@librechat/agents';
import { checkModelRoute } from '~/providers/guard';

type FallbackParams = {
  /** Custom endpoint name selected for this turn. */
  endpoint: string;
  /** The resolved custom endpoint entry, checked so an unrelated endpoint with the same name is untouched. */
  endpointConfig: Partial<TEndpoint> | null | undefined;
  config: ProviderFallbackConfigLike;
  env: Record<string, string | undefined> | undefined;
  modelParameters?: Record<string, unknown>;
  /** Current discovery, used to refuse a fallback that is no longer a verified $0 route. */
  snapshot?: CatalogSnapshot | null;
};

const ENV_PLACEHOLDER = /\$\{([A-Z0-9_]+)\}/g;

function getProviderCredential(provider: ProviderFallbackProvider, env: FallbackParams['env']) {
  return [provider.apiKeyEnv, ...(provider.legacyApiKeyEnv ?? [])]
    .map((name) => env?.[name])
    .find((value): value is string => Boolean(value));
}

/** Resolve legacy credentials only for managed fallback endpoints. */
export function resolveCustomEndpointApiKey(
  endpoint: string,
  endpointConfig: Partial<TEndpoint>,
  config: ProviderFallbackConfigLike,
): string {
  const apiKey = endpointConfig.apiKey ?? '';
  const resolved = extractEnvVariable(apiKey);
  if (resolved !== apiKey.trim()) {
    return resolved;
  }
  const provider = providerFallbackForEndpoint(endpoint);
  if (
    provider?.legacyApiKeyEnv?.length &&
    isProviderFallbackEnabled(config) &&
    isProviderFallbackAllowed(config, provider) &&
    providerFallbackEndpointMatches(endpointConfig, provider, config)
  ) {
    return getProviderCredential(provider, process.env) ?? resolved;
  }
  return resolved;
}

/** Resolve a configured base URL's environment references without exposing them to the client. */
function resolveEnvPlaceholders(
  value: string,
  env: Record<string, string | undefined> | undefined,
): string {
  return value.replace(ENV_PLACEHOLDER, (_match, name: string) => env?.[name] ?? '');
}

/** Generation parameters that are portable across OpenAI-compatible providers. */
function fallbackModelOptions(
  parameters: Record<string, unknown> | undefined,
): Partial<OpenAIClientOptions> {
  const picked: Partial<OpenAIClientOptions> = {};
  if (typeof parameters?.temperature === 'number') {
    picked.temperature = parameters.temperature;
  }
  if (typeof parameters?.topP === 'number') {
    picked.topP = parameters.topP;
  }
  if (typeof parameters?.maxTokens === 'number') {
    picked.maxTokens = parameters.maxTokens;
  }
  if (typeof parameters?.maxCompletionTokens === 'number') {
    picked.maxCompletionTokens = parameters.maxCompletionTokens;
  }
  if (typeof parameters?.frequencyPenalty === 'number') {
    picked.frequencyPenalty = parameters.frequencyPenalty;
  }
  if (typeof parameters?.presencePenalty === 'number') {
    picked.presencePenalty = parameters.presencePenalty;
  }
  if (
    Array.isArray(parameters?.stop) &&
    parameters.stop.every((entry) => typeof entry === 'string')
  ) {
    picked.stop = parameters.stop;
  }
  return picked;
}

/**
 * Build the agents SDK fallback chain for a provider endpoint.
 *
 * The selected provider runs first. Every other configured provider with a
 * credential becomes an ordered `openAI` fallback, so a quota, credit or
 * provider error on the primary turn moves to the next provider instead of
 * failing the request. Returns `undefined` when this is not a managed provider
 * endpoint, when the operator disabled the feature, or when no other
 * credential is available.
 */
export function buildProviderFallbackOptions({
  endpoint,
  endpointConfig,
  config,
  env,
  modelParameters,
  snapshot,
}: FallbackParams): FallbackConfig[] | undefined {
  const primary = providerFallbackForEndpoint(endpoint);
  if (!primary || !isProviderFallbackEnabled(config)) {
    return undefined;
  }
  if (!providerFallbackEndpointMatches(endpointConfig, primary, config)) {
    return undefined;
  }

  const fallbacks: FallbackConfig[] = [];
  for (const provider of providerFallbackOrder(config, primary.id)) {
    if (provider.id === primary.id || !isProviderFallbackAllowed(config, provider)) {
      continue;
    }
    const apiKey = getProviderCredential(provider, env);
    if (!apiKey) {
      continue;
    }
    const model = providerFallbackModel(config, provider);
    if (snapshot) {
      const admission = checkModelRoute(snapshot, { provider: provider.id, model });
      if (!admission.allowed) {
        continue;
      }
    }
    fallbacks.push({
      provider: Providers.OPENAI,
      clientOptions: {
        model,
        apiKey,
        configuration: {
          baseURL: resolveEnvPlaceholders(providerFallbackBaseURL(config, provider), env),
        },
        ...fallbackModelOptions(modelParameters),
      },
      maxContextTokens: provider.contextTokens,
    });
  }

  return fallbacks.length > 0 ? fallbacks : undefined;
}
