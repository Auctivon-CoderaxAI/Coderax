import { rankFreeOrLocalModels } from 'coderax-data-provider';

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

export type WorkModel = {
  id: string;
  label: string;
  provider?: string;
  /** Set on the single option that lets Coderax choose among the listed models. */
  auto?: true;
  /** What the automatic option runs on, so the picker can name it before a task starts. */
  target?: WorkModelTarget;
};

/**
 * Sentinel for "let Coderax pick among the offered models".
 *
 * This is a UI choice only. It is never a provider or model id: a submission
 * must resolve to a concrete model before it reaches the runner or storage.
 */
export const WORK_AUTO_MODEL_ID = 'auto';

export const WORK_AUTO_MODEL_LABEL = 'Automatic';

/** Local runtimes report a bare tag; these prefixes identify them explicitly. */
const LOCAL_PREFIXES = ['ollama/', 'ollama:', 'local/', 'lmstudio/', 'llamacpp/'];

export function isLocalModelId(id: string): boolean {
  const value = id.trim().toLowerCase();
  return LOCAL_PREFIXES.some((prefix) => value.startsWith(prefix));
}

/**
 * A model identifier alone cannot establish where inference runs. Work accepts
 * only sources explicitly marked free or local by the server's model catalog.
 */
export function isWorkSupportedModel(source: WorkModelSource): boolean {
  const id = (source.id ?? source.name ?? '').trim();
  if (!id || id === WORK_AUTO_MODEL_ID) {
    return false;
  }
  return source.free === true || source.local === true;
}

/** Deduplicate by id, keep the first label, and sort for a stable picker. */
export function buildWorkModels(sources: WorkModelSource[]): WorkModel[] {
  const byId = new Map<string, WorkModel>();
  for (const source of sources) {
    if (!isWorkSupportedModel(source)) {
      continue;
    }
    const id = (source.id ?? source.name ?? '').trim();
    if (byId.has(id)) {
      continue;
    }
    byId.set(id, {
      id,
      label: (source.label ?? id).trim(),
      ...(source.provider ? { provider: source.provider } : {}),
    });
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The model the automatic option runs on: the deployment's configured default
 * when that exact model is offered, otherwise the same free/local ranking Chat
 * routes by. Every candidate other than the operator's configured default is
 * free or local, so ranking can never reach an unconfigured paid model.
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
  const [best] = rankFreeOrLocalModels(
    concrete.map((model) => ({
      id: model.id,
      label: model.label,
      provider: model.provider,
      free: true,
    })),
  );
  if (!best) {
    return null;
  }
  return concrete.find((model) => model.id === best.id && model.provider === best.provider) ?? null;
}

/**
 * The operator's configured default is an explicit deployment choice, not a
 * client claim, so it stays selectable even when the catalog does not mark it
 * free or local. Without this, a gateway default such as DeepSeek V4.1 Flash
 * Fast is filtered out and Work shows an empty picker.
 */
function withConfiguredDefault(
  models: WorkModel[],
  sources: WorkModelSource[],
  configuredDefault?: WorkConfiguredDefaultInput,
): WorkModel[] {
  const { id, provider } = readConfiguredDefault(configuredDefault);
  if (!id || id === WORK_AUTO_MODEL_ID) {
    return models;
  }
  const offered = models.find((model) => model.id === id);
  if (offered) {
    /**
     * The catalog deduplicates by id, so a model advertised by two endpoints keeps
     * whichever came first. The deployment's configured endpoint is the one the run
     * must use: match the provider/model pair rather than the id alone.
     */
    if (!provider || offered.provider === provider) {
      return models;
    }
    return models.map((model) => (model.id === id ? { ...model, provider } : model));
  }
  const source =
    sources.find(
      (item) =>
        (item.id ?? item.name ?? '').trim() === id &&
        (!provider || (item.provider ?? '').trim() === provider),
    ) ?? sources.find((item) => (item.id ?? item.name ?? '').trim() === id);
  const resolvedProvider = provider ?? source?.provider?.trim();
  if (!source || !resolvedProvider) {
    return models;
  }
  const label = (source.label ?? id).trim() || id;
  return [...models, { id, label, provider: resolvedProvider }].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
}

/**
 * The picker's options: the automatic choice first, then the concrete models,
 * including the operator's configured default. Automatic is offered only when
 * there is at least one model to choose from, so it can never be selected
 * against an empty list, and it names its target.
 */
export function buildWorkModelOptions(
  sources: WorkModelSource[],
  configuredDefault?: WorkConfiguredDefaultInput,
): WorkModel[] {
  const models = withConfiguredDefault(buildWorkModels(sources), sources, configuredDefault);
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
  return models.filter((model) => model.id !== WORK_AUTO_MODEL_ID);
}

/**
 * A concrete selection is honoured only when it is still offered. Returning
 * `null` tells the caller to resolve explicitly instead of silently swapping
 * the user's choice. The automatic sentinel is never returned as a model.
 */
export function resolveWorkModel(
  models: WorkModel[],
  selected: string | null | undefined,
): WorkModel | null {
  if (!selected || selected === WORK_AUTO_MODEL_ID) {
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
  | { ok: true; model: WorkModel; auto: boolean }
  | { ok: false; reason: WorkModelSelectionFailure };

/**
 * Resolve the concrete model a Work submission will store and invoke with.
 *
 * `auto` resolves through `resolveWorkAutoModel`: the configured default when
 * it is offered, otherwise the top-ranked free/local model, which the picker
 * names before the task starts. It fails with `auto_unresolved` only when
 * nothing is offered. A paid gateway default is never selected, and an omitted
 * model never routes to one.
 */
export function resolveWorkSelection(
  models: WorkModel[],
  selected: string | null | undefined,
  configuredDefault?: WorkConfiguredDefaultInput,
): WorkModelSelection {
  const concrete = workConcreteModels(models);

  if (selected && selected !== WORK_AUTO_MODEL_ID) {
    const match = concrete.find((model) => model.id === selected);
    return match
      ? { ok: true, model: match, auto: false }
      : { ok: false, reason: 'model_unavailable' };
  }

  /** `concrete` already excludes paid gateway models, so membership is the proof. */
  const fallback = resolveWorkAutoModel(concrete, configuredDefault);
  return fallback
    ? { ok: true, model: fallback, auto: true }
    : { ok: false, reason: 'auto_unresolved' };
}
