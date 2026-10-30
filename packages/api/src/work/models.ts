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

export type WorkModel = {
  id: string;
  label: string;
  provider?: string;
  /** Set on the single option that lets Coderax choose among the listed models. */
  auto?: true;
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
 * Work offers models Coderax can run without charging the user: explicitly
 * free, explicitly local, or a local-runtime identifier. Paid gateway models
 * are excluded rather than silently filtered at execution time, so the picker
 * never advertises something the run would reject.
 */
export function isWorkSupportedModel(source: WorkModelSource): boolean {
  const id = (source.id ?? source.name ?? '').trim();
  if (!id || id === WORK_AUTO_MODEL_ID) {
    return false;
  }
  return source.free === true || source.local === true || isLocalModelId(id);
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
 * The picker's options: the automatic choice first, then the concrete models.
 * Automatic is offered only when there is at least one model to choose from,
 * so it can never be selected against an empty list.
 */
export function buildWorkModelOptions(sources: WorkModelSource[]): WorkModel[] {
  const models = buildWorkModels(sources);
  if (models.length === 0) {
    return [];
  }
  return [{ id: WORK_AUTO_MODEL_ID, label: WORK_AUTO_MODEL_LABEL, auto: true }, ...models];
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

export type WorkModelSelectionFailure = 'model_unavailable' | 'auto_unresolved';

export type WorkModelSelection =
  | { ok: true; model: WorkModel; auto: boolean }
  | { ok: false; reason: WorkModelSelectionFailure };

/**
 * Resolve the concrete model a Work submission will store and invoke with.
 *
 * `auto` is resolved through the deployment's configured default, and only
 * when that default is present among the offered free/local models. Anything
 * else fails with `auto_unresolved` so the caller can report an actionable
 * configuration error. A paid gateway default is never selected, and an
 * omitted model never routes to one.
 */
export function resolveWorkSelection(
  models: WorkModel[],
  selected: string | null | undefined,
  configuredDefault?: string | null,
): WorkModelSelection {
  const concrete = workConcreteModels(models);

  if (selected && selected !== WORK_AUTO_MODEL_ID) {
    const match = concrete.find((model) => model.id === selected);
    return match
      ? { ok: true, model: match, auto: false }
      : { ok: false, reason: 'model_unavailable' };
  }

  const fallbackId = configuredDefault?.trim();
  if (!fallbackId) {
    return { ok: false, reason: 'auto_unresolved' };
  }
  /** `concrete` already excludes paid gateway models, so membership is the proof. */
  const fallback = concrete.find((model) => model.id === fallbackId);
  return fallback
    ? { ok: true, model: fallback, auto: true }
    : { ok: false, reason: 'auto_unresolved' };
}
