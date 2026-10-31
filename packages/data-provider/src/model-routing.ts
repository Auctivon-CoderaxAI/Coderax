import { isAgentsEndpoint, isAssistantsEndpoint } from './schemas';

/**
 * Model routing for surfaces that must pick a model without offering a picker.
 *
 * A route candidate is any model the deployment actually configured. Free and
 * local candidates are ranked by capability, speed and reliability; paid models
 * are never selected automatically, they are only offered to the caller so it
 * can ask for explicit consent before a request.
 */

export type ModelRouteSource = {
  id?: string | null;
  label?: string | null;
  /** Endpoint/provider the model was configured under. */
  provider?: string | null;
  free?: boolean;
  local?: boolean;
  /** Normalized 0..1 signals; omitted values are neutral, never guessed. */
  capability?: number;
  speed?: number;
  reliability?: number;
  context?: number;
  promptCost?: number;
  completionCost?: number;
};

export type ModelRouteCandidate = {
  id: string;
  label: string;
  provider?: string;
  free: boolean;
  local: boolean;
  capability: number;
  speed: number;
  reliability: number;
  context?: number;
  promptCost?: number;
  completionCost?: number;
  /** Sum of the known prompt and completion rates per million tokens. */
  costPerMillion?: number;
};

export type AutomaticChatModel =
  | { ok: true; model: ModelRouteCandidate; alternatives: ModelRouteCandidate[] }
  | { ok: false; reason: 'no_free_local_model'; paid: ModelRouteCandidate | null };

/** Endpoints whose models run on the deployment's own hardware. */
const LOCAL_ENDPOINTS = new Set(['ollama', 'lmstudio', 'local', 'llamacpp']);

/** Local runtimes report a bare tag; these prefixes identify them explicitly. */
const LOCAL_PREFIXES = ['ollama/', 'ollama:', 'local/', 'lmstudio/', 'llamacpp/'];

/** Neutral score for a model that carries no routing metadata. */
const DEFAULT_SIGNAL = 0.5;

export function isLocalModelProvider(provider: string | null | undefined): boolean {
  return provider != null && LOCAL_ENDPOINTS.has(provider.trim().toLowerCase());
}

function isLocalModelId(id: string): boolean {
  const value = id.trim().toLowerCase();
  return LOCAL_PREFIXES.some((prefix) => value.startsWith(prefix));
}

/**
 * Free or local means the call does not bill the user's provider account.
 * Only signals the deployment actually carries count: an explicit flag, a local
 * endpoint, a local-runtime identifier, or a `:free` model tag.
 */
export function isFreeOrLocalModel(source: ModelRouteSource): boolean {
  const id = (source.id ?? '').trim();
  const hasZeroTokenCost = source.promptCost === 0 && source.completionCost === 0;
  return (
    source.free === true ||
    source.local === true ||
    hasZeroTokenCost ||
    isLocalModelProvider(source.provider) ||
    (id.length > 0 && (isLocalModelId(id) || id.toLowerCase().endsWith(':free')))
  );
}

function normalizeSignal(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) {
    return DEFAULT_SIGNAL;
  }
  return Math.min(1, Math.max(0, value));
}

/** Project a configured model into a ranked candidate, or reject an unusable one. */
export function toModelRouteCandidate(source: ModelRouteSource): ModelRouteCandidate | null {
  const id = (source.id ?? '').trim();
  if (!id) {
    return null;
  }
  const free = isFreeOrLocalModel(source);
  const promptCost = Number.isFinite(source.promptCost) ? source.promptCost : undefined;
  const completionCost = Number.isFinite(source.completionCost) ? source.completionCost : undefined;
  let costPerMillion: number | undefined;
  if (free) {
    costPerMillion = 0;
  } else if (promptCost != null && completionCost != null) {
    costPerMillion = promptCost + completionCost;
  }
  return {
    id,
    label: (source.label ?? id).trim() || id,
    ...(source.provider ? { provider: source.provider } : {}),
    free,
    local: isLocalModelProvider(source.provider) || isLocalModelId(id),
    capability: normalizeSignal(source.capability),
    speed: normalizeSignal(source.speed),
    reliability: normalizeSignal(source.reliability),
    ...(Number.isFinite(source.context) && source.context! > 0 ? { context: source.context } : {}),
    ...(promptCost != null ? { promptCost } : {}),
    ...(completionCost != null ? { completionCost } : {}),
    ...(costPerMillion !== undefined ? { costPerMillion } : {}),
  };
}

/**
 * Best candidate first by capability, then speed, then reliability. Local
 * execution wins the final tie over a free remote call, and the provider/id
 * pair keeps the order stable across catalog responses.
 */
export function compareModelRoutes(a: ModelRouteCandidate, b: ModelRouteCandidate): number {
  if (a.capability !== b.capability) {
    return b.capability - a.capability;
  }
  if (a.speed !== b.speed) {
    return b.speed - a.speed;
  }
  if (a.reliability !== b.reliability) {
    return b.reliability - a.reliability;
  }
  if (a.context != null && b.context != null && a.context !== b.context) {
    return b.context - a.context;
  }
  if (
    a.costPerMillion != null &&
    b.costPerMillion != null &&
    a.costPerMillion !== b.costPerMillion
  ) {
    return a.costPerMillion - b.costPerMillion;
  }
  if (a.costPerMillion != null && b.costPerMillion == null) {
    return -1;
  }
  if (b.costPerMillion != null && a.costPerMillion == null) {
    return 1;
  }
  if (a.local !== b.local) {
    return a.local ? -1 : 1;
  }
  if (a.free !== b.free) {
    return a.free ? -1 : 1;
  }
  const byId = a.id.localeCompare(b.id);
  return byId !== 0 ? byId : (a.provider ?? '').localeCompare(b.provider ?? '');
}

/**
 * Rank the configured free/local models. Anything that would bill the user is
 * excluded here, so callers can never reach a paid model by ordering alone.
 */
export function rankFreeOrLocalModels(sources: ModelRouteSource[]): ModelRouteCandidate[] {
  const seen = new Set<string>();
  const candidates: ModelRouteCandidate[] = [];
  for (const source of sources) {
    const candidate = toModelRouteCandidate(source);
    if (!candidate || !isFreeOrLocalModel(source)) {
      continue;
    }
    const key = `${candidate.provider ?? ''}\u0000${candidate.id}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    candidates.push(candidate);
  }
  return candidates.sort(compareModelRoutes);
}

function rankPaidModels(
  sources: ModelRouteSource[],
  preferredPaidModel?: string | null,
): ModelRouteCandidate[] {
  const seen = new Set<string>();
  const candidates: ModelRouteCandidate[] = [];
  for (const source of sources) {
    if (isFreeOrLocalModel(source)) {
      continue;
    }
    const candidate = toModelRouteCandidate(source);
    if (!candidate) {
      continue;
    }
    const key = `${candidate.provider ?? ''}\u0000${candidate.id}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    candidates.push(candidate);
  }
  candidates.sort(compareModelRoutes);

  const preferred = preferredPaidModel?.trim();
  if (!preferred) {
    return candidates;
  }
  const index = candidates.findIndex((candidate) => candidate.id === preferred);
  if (index <= 0) {
    return candidates;
  }
  return [
    candidates[index] as ModelRouteCandidate,
    ...candidates.slice(0, index),
    ...candidates.slice(index + 1),
  ];
}

/**
 * Choose automatically among the actually configured models.
 *
 * The primary is the highest-ranked free/local model, and `alternatives` is
 * the ordered rest of that same set for safe selection-time failover. When no
 * free/local model exists the result names a paid fallback but never selects
 * it: the caller must obtain explicit consent first.
 */
export function selectAutomaticChatModel(
  sources: ModelRouteSource[],
  { preferredPaidModel }: { preferredPaidModel?: string | null } = {},
): AutomaticChatModel {
  const ranked = rankFreeOrLocalModels(sources);
  if (ranked.length > 0) {
    const [model, ...alternatives] = ranked;
    return { ok: true, model: model as ModelRouteCandidate, alternatives };
  }
  const paid = rankPaidModels(sources, preferredPaidModel);
  return { ok: false, reason: 'no_free_local_model', paid: paid[0] ?? null };
}

/**
 * A concrete model target needs consent when it would bill the provider.
 * Agent and assistant chats choose their model through the agent definition,
 * not through a per-message model selection, so they are out of scope.
 */
export function isPaidModelTarget({
  endpoint,
  endpointType,
  model,
}: {
  endpoint?: string | null;
  endpointType?: string | null;
  model?: string | null;
}): boolean {
  const id = model?.trim();
  const effectiveEndpoint = endpointType ?? endpoint;
  if (!id || !effectiveEndpoint) {
    return false;
  }
  if (isAgentsEndpoint(effectiveEndpoint) || isAssistantsEndpoint(effectiveEndpoint)) {
    return false;
  }
  return !isFreeOrLocalModel({ id, provider: endpoint ?? effectiveEndpoint });
}
