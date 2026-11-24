import {
  isWorkRoutingMode,
  rankFreeOrLocalModels,
  selectModelForMode,
  WORK_AUTO_MODEL_ID,
  WORK_ROUTING_MODES,
} from 'coderax-data-provider';
import type { ModelRouteSource, TWorkRoutingMode } from 'coderax-data-provider';

export { WORK_AUTO_MODEL_ID, WORK_ROUTING_MODES };

/**
 * Work model options come from Coderax's own configuration. Nothing here reads
 * CyVox: an unconfigured or offline CyVox must not change this list.
 */

export type WorkModelSource = {
  /** Configured model identifier, e.g. `gpt-4o-mini` or `llama3:latest`. */
  id?: string;
  name?: string;
  /** Optional display label already resolved by the caller. */
  label?: string;
  provider?: string;
  /** Coderax marks models it can run without an external paid endpoint. */
  free?: boolean;
  local?: boolean;
  /** Verified provider capability signals; absent means unknown, not unsupported. */
  tools?: boolean;
  reasoning?: boolean;
  /** Verified context window in tokens, when the provider publishes one. */
  contextTokens?: number;
  /** Last measured minimal-turn latency, when a probe produced one. */
  latencyMs?: number;
  /** Normalized 0..1 routing signals; absent values stay neutral. */
  capability?: number;
  speed?: number;
  reliability?: number;
};

export type WorkModelTarget = {
  id: string;
  label: string;
  provider?: string;
};

/** The deployment's configured default: the model id and, when known, its endpoint. */
export type WorkConfiguredDefault = {
  id: string;
  provider?: string;
};

export type WorkConfiguredDefaultInput = string | WorkConfiguredDefault | null | undefined;

/**
 * Normalize the string form (older callers) and the endpoint-aware object form.
 * The provider matters when two endpoints advertise the same model id.
 */
function readConfiguredDefault(input: WorkConfiguredDefaultInput): {
  id?: string;
  provider?: string;
} {
  if (!input) {
    return {};
  }
  if (typeof input === 'string') {
    return { id: input.trim() };
  }
  const id = typeof input.id === 'string' ? input.id.trim() : '';
  const provider = typeof input.provider === 'string' ? input.provider.trim() : '';
  return { ...(id ? { id } : {}), ...(provider ? { provider } : {}) };
}

/**
 * Accepts a resolver result of unknown shape (the route layer passes its
 * dependency through) and keeps only a usable default.
 */
export function normalizeConfiguredDefault(input: unknown): WorkConfiguredDefaultInput {
  if (typeof input === 'string') {
    return input.trim() || null;
  }
  if (input == null || typeof input !== 'object') {
    return null;
  }
  const { id, provider } = readConfiguredDefault(input as WorkConfiguredDefault);
  if (!id) {
    return null;
  }
  return provider ? { id, provider } : { id };
}

export type WorkModel = {
  id: string;
  label: string;
  provider?: string;
  /** Set on the single option that lets Coderax choose among the listed models. */
  auto?: true;
  /** The routing intent this option sends back to the server. */
  routingMode?: TWorkRoutingMode;
  /** What the option runs on, so the picker can name it before a task starts. */
  target?: WorkModelTarget;
  /** Verified capability metadata copied from the catalog for routing. */
  tools?: boolean;
  reasoning?: boolean;
  contextTokens?: number;
  latencyMs?: number;
  capability?: number;
  speed?: number;
  reliability?: number;
};

/** The routing intents Work offers; `auto` remains the default sentinel. */
export const WORK_AUTO_MODEL_LABEL = 'Automatic';

const WORK_ROUTING_LABELS: Record<TWorkRoutingMode, string> = {
  auto: WORK_AUTO_MODEL_LABEL,
  fast: 'Fast',
  complex: 'Complex',
  agent: 'Agent',
};

/** Local runtimes report a bare tag; these prefixes identify them explicitly. */
const LOCAL_PREFIXES = ['ollama/', 'ollama:', 'local/', 'lmstudio/', 'llamacpp/'];

export function isLocalModelId(id: string): boolean {
  const value = id.trim().toLowerCase();
  return LOCAL_PREFIXES.some((prefix) => value.startsWith(prefix));
}

/**
 * A model identifier alone cannot establish where inference runs. Work accepts
 * only sources explicitly marked free or local. The managed catalog marks its
 * sources free after validating the endpoint and credential configuration.
 */
export function isWorkSupportedModel(source: WorkModelSource): boolean {
  const id = (source.id ?? source.name ?? '').trim();
  if (!id || isWorkRoutingMode(id)) {
    return false;
  }
  return source.free === true || source.local === true;
}

function routingMetadata(source: WorkModelSource): Partial<WorkModel> {
  return {
    ...(typeof source.tools === 'boolean' ? { tools: source.tools } : {}),
    ...(typeof source.reasoning === 'boolean' ? { reasoning: source.reasoning } : {}),
    ...(Number.isFinite(source.contextTokens) && source.contextTokens! > 0
      ? { contextTokens: source.contextTokens }
      : {}),
    ...(Number.isFinite(source.latencyMs) && source.latencyMs! >= 0
      ? { latencyMs: source.latencyMs }
      : {}),
    ...(Number.isFinite(source.capability) ? { capability: source.capability } : {}),
    ...(Number.isFinite(source.speed) ? { speed: source.speed } : {}),
    ...(Number.isFinite(source.reliability) ? { reliability: source.reliability } : {}),
  };
}

/**
 * The Work submission contract selects concrete models by id alone. Until that
 * contract supports provider-qualified ids end to end, refuse ambiguous ids
 * rather than silently routing a request to whichever provider appeared first.
 * Repeated catalog entries from the same provider remain deduplicated.
 */
export function buildWorkModels(sources: WorkModelSource[]): WorkModel[] {
  const byId = new Map<string, WorkModel>();
  const ambiguous = new Set<string>();
  for (const source of sources) {
    if (!isWorkSupportedModel(source)) {
      continue;
    }
    const id = (source.id ?? source.name ?? '').trim();
    const provider = source.provider?.trim() || undefined;
    const existing = byId.get(id);
    if (existing && existing.provider !== provider) {
      ambiguous.add(id);
      continue;
    }
    if (!existing) {
      byId.set(id, {
        id,
        label: (source.label ?? id).trim() || id,
        ...(provider ? { provider } : {}),
        ...routingMetadata(source),
      });
    }
  }
  return [...byId.values()]
    .filter((model) => !ambiguous.has(model.id))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function toRoutingSource(model: WorkModel): ModelRouteSource {
  return {
    id: model.id,
    label: model.label,
    provider: model.provider,
    free: true,
    ...(model.contextTokens != null ? { context: model.contextTokens } : {}),
    ...(typeof model.tools === 'boolean' ? { tools: model.tools } : {}),
    ...(typeof model.reasoning === 'boolean' ? { reasoning: model.reasoning } : {}),
    ...(model.latencyMs != null ? { latencyMs: model.latencyMs } : {}),
    ...(model.capability != null ? { capability: model.capability } : {}),
    ...(model.speed != null ? { speed: model.speed } : {}),
    ...(model.reliability != null ? { reliability: model.reliability } : {}),
  };
}

/**
 * The model an intent resolves to. AUTO keeps the operator's configured
 * default when it is offered; every other intent ranks the offered free/local
 * models by its own signal, so a latency or context preference is not
 * overridden by a deployment default.
 */
function resolveRoutingTarget(
  models: WorkModel[],
  mode: TWorkRoutingMode,
  configuredDefault?: WorkConfiguredDefaultInput,
): WorkModel | null {
  if (mode === 'auto') {
    return resolveWorkAutoModel(models, configuredDefault);
  }
  const selection = selectModelForMode(models.map(toRoutingSource), { mode });
  if (!selection.ok) {
    return null;
  }
  const candidate = selection.model;
  return (
    models.find((model) => model.id === candidate.id && model.provider === candidate.provider) ??
    null
  );
}

/**
 * The routing intents Work offers, each naming the concrete model it resolves
 * to right now. Every target comes from the offered free/local list, so a mode
 * can never introduce a paid model or an unadvertised one.
 */
export function buildWorkRoutingOptions(
  models: WorkModel[],
  configuredDefault?: WorkConfiguredDefaultInput,
): WorkModel[] {
  const concrete = workConcreteModels(models);
  if (concrete.length === 0) {
    return [];
  }
  const options: WorkModel[] = [];
  for (const mode of WORK_ROUTING_MODES) {
    const target = resolveRoutingTarget(concrete, mode, configuredDefault);
    if (!target) {
      continue;
    }
    options.push({
      id: mode,
      label: WORK_ROUTING_LABELS[mode],
      auto: true,
      routingMode: mode,
      target: {
        id: target.id,
        label: target.label,
        ...(target.provider ? { provider: target.provider } : {}),
      },
    });
  }
  return options;
}

/**
 * The model the automatic option runs on: the deployment's configured default
 * when that exact model is offered, otherwise the same free/local ranking Chat
 * routes by. Every candidate other than the operator's configured default is
 * free or local, so ranking cannot reach an unverified paid model.
 */
export function resolveWorkAutoModel(
  models: WorkModel[],
  configuredDefault?: WorkConfiguredDefaultInput,
): WorkModel | null {
  const concrete = workConcreteModels(models);
  const { id: fallbackId, provider: fallbackProvider } = readConfiguredDefault(configuredDefault);
  const configured = fallbackId
    ? concrete.find(
        (model) =>
          model.id === fallbackId && (!fallbackProvider || model.provider === fallbackProvider),
      )
    : undefined;
  if (configured) {
    return configured;
  }
  const [best] = rankFreeOrLocalModels(concrete.map(toRoutingSource));
  if (!best) {
    return null;
  }
  return concrete.find((model) => model.id === best.id && model.provider === best.provider) ?? null;
}

/**
 * The picker's options: the automatic choice first, then the concrete models,
 * including an operator default only if it is independently catalogued free/local. Automatic is offered only when
 * there is at least one model to choose from, so it can never be selected
 * against an empty list, and it names its target.
 */
export function buildWorkModelOptions(
  sources: WorkModelSource[],
  configuredDefault?: WorkConfiguredDefaultInput,
): WorkModel[] {
  const models = buildWorkModels(sources);
  const target = resolveWorkAutoModel(models, configuredDefault);
  if (!target) {
    return [];
  }
  return [
    {
      id: WORK_AUTO_MODEL_ID,
      label: WORK_AUTO_MODEL_LABEL,
      auto: true,
      target: {
        id: target.id,
        label: target.label,
        ...(target.provider ? { provider: target.provider } : {}),
      },
    },
    ...models,
  ];
}

/** The concrete models a submission may actually run on. */
export function workConcreteModels(models: WorkModel[]): WorkModel[] {
  return models.filter((model) => !isWorkRoutingMode(model.id));
}

/**
 * A concrete selection is honoured only when it is still offered. Returning
 * `null` tells the caller to resolve explicitly instead of silently swapping
 * the user's choice. A routing sentinel is never returned as a model.
 */
export function resolveWorkModel(
  models: WorkModel[],
  selected: string | null | undefined,
): WorkModel | null {
  if (!selected || isWorkRoutingMode(selected)) {
    return null;
  }
  return workConcreteModels(models).find((model) => model.id === selected) ?? null;
}

export type WorkAgentSource = {
  id?: string;
  /** The model the native runner will use for this agent, not the request body's. */
  model?: string;
  provider?: string;
};

/**
 * A persisted agent runs on its own configured model and provider. The submitted
 * `model` is client input and cannot authorize the agent, so both the agent's id
 * and its provider must match an offered free/local model. A provider mismatch is
 * a paid-agent bypass even when the model name collides with a local one.
 */
export function resolveWorkAgentModel(
  models: WorkModel[],
  agent: WorkAgentSource | null | undefined,
): WorkModel | null {
  if (!agent || typeof agent.id !== 'string' || !agent.id) {
    return null;
  }
  const modelId = (agent.model ?? '').trim();
  const provider = (agent.provider ?? '').trim();
  if (!modelId || !provider) {
    return null;
  }
  return (
    workConcreteModels(models).find(
      (model) => model.id === modelId && model.provider === provider,
    ) ?? null
  );
}

export type WorkModelSelectionFailure = 'model_unavailable' | 'auto_unresolved';

export type WorkModelSelection =
  | { ok: true; model: WorkModel; auto: boolean; routingMode?: TWorkRoutingMode }
  | { ok: false; reason: WorkModelSelectionFailure };

/**
 * Resolve the concrete model a Work submission will store and invoke with.
 *
 * A routing sentinel resolves through its own intent: AUTO keeps the configured
 * default when offered, FAST prefers the lowest measured latency, COMPLEX the
 * largest verified context, and AGENT requires tool calling. A concrete id is
 * honoured only when it is still offered. When nothing is offered the selection
 * fails closed; no mode reaches a paid model.
 */
export function resolveWorkSelection(
  models: WorkModel[],
  selected: string | null | undefined,
  configuredDefault?: WorkConfiguredDefaultInput,
): WorkModelSelection {
  const concrete = workConcreteModels(models);

  if (selected && isWorkRoutingMode(selected)) {
    const model = resolveRoutingTarget(concrete, selected, configuredDefault);
    return model
      ? { ok: true, model, auto: true, routingMode: selected }
      : { ok: false, reason: 'auto_unresolved' };
  }

  if (selected && selected !== WORK_AUTO_MODEL_ID) {
    const match = concrete.find((model) => model.id === selected);
    return match
      ? { ok: true, model: match, auto: false }
      : { ok: false, reason: 'model_unavailable' };
  }

  /** Only server-catalogued free/local models enter this option list. */
  const fallback = resolveWorkAutoModel(concrete, configuredDefault);
  return fallback
    ? { ok: true, model: fallback, auto: true, routingMode: 'auto' }
    : { ok: false, reason: 'auto_unresolved' };
}
