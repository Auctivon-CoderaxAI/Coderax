import { getEndpointField, isAgentsEndpoint, isAssistantsEndpoint } from 'coderax-data-provider';
import type {
  ModelRouteSource,
  TEndpointsConfig,
  TModelsConfig,
  TTokenConfigMap,
  TPreset,
  TStartupConfig,
} from 'coderax-data-provider';

type ModelEntry =
  | string
  | {
      id?: string;
      name?: string;
      label?: string;
      free?: boolean;
      local?: boolean;
      capability?: number;
      speed?: number;
      reliability?: number;
    };

/**
 * Only models the server actually returned for a configured, non-agent
 * endpoint are candidates. An agent's model belongs to the agent definition,
 * so it is never chosen as Chat's per-message model.
 */
export function buildChatModelSources(
  modelsConfig: TModelsConfig | undefined,
  endpointsConfig: TEndpointsConfig | undefined,
  tokenConfig?: TTokenConfigMap,
): ModelRouteSource[] {
  const sources: ModelRouteSource[] = [];
  for (const [endpoint, models] of Object.entries(modelsConfig ?? {})) {
    if (endpointsConfig?.[endpoint] == null) {
      continue;
    }
    if (isAgentsEndpoint(endpoint) || isAssistantsEndpoint(endpoint)) {
      continue;
    }
    const tokenModels = tokenConfig?.[endpoint] ?? {};
    for (const entry of (models ?? []) as ModelEntry[]) {
      if (typeof entry === 'string') {
        const tokenomics = tokenModels[entry];
        sources.push({
          id: entry,
          provider: endpoint,
          context: tokenomics?.context,
          promptCost: tokenomics?.prompt,
          completionCost: tokenomics?.completion,
        });
        continue;
      }
      if (entry == null || typeof entry !== 'object') {
        continue;
      }
      const model = entry as Exclude<ModelEntry, string>;
      const id = model.id ?? model.name;
      if (!id) {
        continue;
      }
      const tokenomics = tokenModels[String(id)];
      sources.push({
        id: String(id),
        label: model.label ?? model.name ?? String(id),
        provider: endpoint,
        free: model.free,
        local: model.local,
        capability: model.capability,
        speed: model.speed,
        reliability: model.reliability,
        context: tokenomics?.context,
        promptCost: tokenomics?.prompt,
        completionCost: tokenomics?.completion,
      });
    }
  }
  return sources;
}

/** The deployment's configured default model, when one is configured. */
export function getConfiguredDefaultModel(
  startupConfig: TStartupConfig | undefined,
): string | null {
  const specs = startupConfig?.modelSpecs?.list;
  if (!Array.isArray(specs)) {
    return null;
  }
  const chosen =
    specs.find((spec) => spec?.default === true) ??
    specs.find((spec) => spec?.softDefault === true);
  const model = chosen?.preset?.model;
  return typeof model === 'string' && model.trim() !== '' ? model.trim() : null;
}

/** Build the conversation preset that pins an automatically selected model. */
export function toChatModelPreset(
  model: { id: string; provider?: string },
  endpointsConfig: TEndpointsConfig | undefined,
): TPreset | undefined {
  if (!model.provider) {
    return undefined;
  }
  const endpointType = getEndpointField(endpointsConfig, model.provider, 'type');
  return {
    endpoint: model.provider as TPreset['endpoint'],
    ...(endpointType ? { endpointType: endpointType as TPreset['endpointType'] } : {}),
    model: model.id,
  };
}
