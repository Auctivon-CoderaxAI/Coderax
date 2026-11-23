/**
 * Zero-cost model guard for the OpenCode engine.
 *
 * Coderax must never start an engine run on a model that can bill the owner.
 * OpenCode resolves a default model from its own configuration, which Coderax
 * cannot trust: a global `opencode.json` may name a paid model. The operator
 * therefore names the model explicitly in `engines.opencode.model`, and this
 * module accepts only:
 *
 *  - an allowlisted free OpenCode model, published on the OpenCode Console
 *    free-tier list, or
 *  - a model served by a local runtime (`ollama`, `lmstudio`).
 *
 * The list was read from https://opencode.ai/docs/console/models/ on
 * 2026-11-18. A model absent from it is refused; there is no paid fallback.
 */

export type EngineModelRef = {
  providerId: string;
  modelId: string;
};

/** Exact free-tier ids, including the stealth models published as free. */
export const OPENCODE_FREE_MODEL_IDS: readonly string[] = [
  'deepseek-v4.1-flash-free',
  'nemotron-3.5-lightning-free',
  'big-pickle',
  'iceman-free',
  'inkling-2-small-free',
  'beam-free',
  'flint-40b-free',
  'longcat-2.5-free',
  'hy4-flash-free',
  'mimo-v2.6-flash-free',
];

/** Providers whose weights run on the operator's own machine. */
export const LOCAL_MODEL_PROVIDERS: readonly string[] = ['ollama', 'lmstudio'];

const FREE = new Set(OPENCODE_FREE_MODEL_IDS);
const LOCAL = new Set(LOCAL_MODEL_PROVIDERS);

/** Ollama's local API can proxy cloud models; the provider alone is not proof of locality. */
function isCloudBackedLocalModel(model: EngineModelRef): boolean {
  return model.providerId === 'ollama' && /(?:^|[-_:])cloud(?:$|[-_:])/i.test(model.modelId);
}

/**
 * Parse the `provider/model` form OpenCode uses. The model id itself may
 * contain slashes (for example a Hugging Face tag), so only the first slash
 * separates the provider.
 */
export function parseEngineModel(value: string | undefined | null): EngineModelRef | null {
  const trimmed = (value ?? '').trim();
  const slash = trimmed.indexOf('/');
  if (slash <= 0 || slash === trimmed.length - 1) {
    return null;
  }
  const providerId = trimmed.slice(0, slash).trim().toLowerCase();
  const modelId = trimmed.slice(slash + 1).trim();
  if (!providerId || !modelId || /\s/.test(providerId)) {
    return null;
  }
  return { providerId, modelId };
}

/** True only for a catalogued free hosted model or local weights. */
export function isZeroCostModel(model: EngineModelRef | null | undefined): boolean {
  if (!model) {
    return false;
  }
  if (model.providerId === 'opencode') {
    return FREE.has(model.modelId);
  }
  return LOCAL.has(model.providerId);
}

/**
 * A private Work run must not reach a hosted provider at all, so a free cloud
 * model is still invalid there even though it costs nothing. Cloud mode admits
 * free hosted models as well as local weights.
 */
export function isModelAllowedForMode(
  model: EngineModelRef | null | undefined,
  mode: 'private' | 'cloud',
): boolean {
  if (!isZeroCostModel(model) || !model) {
    return false;
  }
  return !isCloudBackedLocalModel(model) && (mode === 'cloud' || LOCAL.has(model.providerId));
}

export const PRIVATE_MODEL_DETAIL: string =
  'Private Work runs require a local model (ollama or lmstudio). ' +
  'Free hosted models are available only when engines.workChat.mode is cloud.';

/** User-safe explanation; names the accepted shape, never a credential. */
export const ZERO_COST_MODEL_DETAIL: string =
  'engines.opencode.model must name an allowlisted free OpenCode model ' +
  `(${OPENCODE_FREE_MODEL_IDS.slice(0, 3).join(', ')}, …) or a local provider ` +
  `model (${LOCAL_MODEL_PROVIDERS.join(', ')}).`;
