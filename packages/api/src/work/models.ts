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
};

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
  if (!id) {
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
 * A selection is honoured only when it is still offered. Returning `null`
 * tells the caller to fall back explicitly instead of silently swapping the
 * user's choice, which is what the previous surface did.
 */
export function resolveWorkModel(
  models: WorkModel[],
  selected: string | null | undefined,
): WorkModel | null {
  if (!selected) {
    return null;
  }
  return models.find((model) => model.id === selected) ?? null;
}
