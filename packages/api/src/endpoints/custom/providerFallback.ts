import { Providers } from '@librechat/agents';
import {
  isProviderFallbackEnabled,
  providerFallbackBaseURL,
  providerFallbackEndpointMatches,
  providerFallbackForEndpoint,
  providerFallbackModel,
  providerFallbackOrder,
} from 'coderax-data-provider';
import type { ProviderFallbackConfigLike, TEndpoint } from 'coderax-data-provider';
import type { FallbackConfig, OpenAIClientOptions } from '@librechat/agents';

type FallbackParams = {
  /** Custom endpoint name selected for this turn. */
  endpoint: string;
  /** The resolved custom endpoint entry, checked so an unrelated endpoint with the same name is untouched. */
  endpointConfig: Partial<TEndpoint> | null | undefined;
  config: ProviderFallbackConfigLike;
  env: Record<string, string | undefined> | undefined;
  modelParameters?: Record<string, unknown>;
};

const ENV_PLACEHOLDER = /\$\{([A-Z0-9_]+)\}/g;

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
    if (provider.id === primary.id) {
      continue;
    }
    const apiKey = env?.[provider.apiKeyEnv];
    if (!apiKey) {
      continue;
    }
    fallbacks.push({
      provider: Providers.OPENAI,
      clientOptions: {
        model: providerFallbackModel(config, provider),
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
