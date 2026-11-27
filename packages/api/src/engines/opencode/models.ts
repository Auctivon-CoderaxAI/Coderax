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

/**
 * OpenRouter models whose `:free` variant is listed at prompt and completion
 * price 0 and that advertise native tool calling. Read from
 * https://openrouter.ai/api/v1/models on 2026-11-23. Ordered best first; the
 * order is operator preference, not a measured benchmark.
 */
export const OPENROUTER_FREE_MODEL_IDS: readonly string[] = [
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'nvidia/nemotron-3.5-lightning:free',
  'google/gemma-4-31b-it:free',
];

/** Providers whose weights run on the operator's own machine. */
export const LOCAL_MODEL_PROVIDERS: readonly string[] = ['ollama', 'lmstudio'];

const FREE = new Set(OPENCODE_FREE_MODEL_IDS);
const FREE_ROUTER = new Set(OPENROUTER_FREE_MODEL_IDS);
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
  if (model.providerId === 'openrouter') {
    return FREE_ROUTER.has(model.modelId);
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

/**
 * `auto` chooses among the verified $0 candidates at run time instead of pinning
 * one model id. It is resolved here, never by the OpenCode server's own default,
 * which could name a paid model.
 */
export const AUTO_MODEL = 'auto';

/** Server variable holding the OpenRouter credential; never a config value. */
export const OPENROUTER_API_KEY_ENV = 'OPENROUTER_API_KEY';

/** User-safe explanation; names the accepted shape, never a credential. */
export const ZERO_COST_MODEL_DETAIL: string =
  'engines.opencode.model must be `auto`, an allowlisted free OpenCode model ' +
  `(${OPENCODE_FREE_MODEL_IDS.slice(0, 3).join(', ')}), a verified $0 OpenRouter ` +
  `model (${OPENROUTER_FREE_MODEL_IDS.join(', ')}), or a local provider model ` +
  `(${LOCAL_MODEL_PROVIDERS.join(', ')}).`;

/**
 * The built-in OpenCode provider needs no credential (its key is published as
 * `public`), but OpenCode meters it per client, so it is a last resort: a cloud
 * host commonly receives "Free usage limit reached" instead of an answer.
 */
const OPENCODE_FREE_PROVIDER = 'opencode';

const DEFAULT_AUTO_ATTEMPTS = 3;
const MAX_AUTO_ATTEMPTS = 5;

export type ModelCandidate = {
  model: EngineModelRef;
  /** A server variable that must be present before this candidate can run. */
  requireEnv?: string;
};

export type ModelPlan = {
  auto: boolean;
  candidates: ModelCandidate[];
  /** User-safe reason no candidate can run; absent when candidates exist. */
  detail?: string;
};

export const PRIVATE_AUTO_DETAIL: string =
  'engines.opencode.model: auto selects free hosted models, so it requires ' +
  'engines.workChat.mode: cloud. A private run must name a local model explicitly.';

function bounded(attempts: number | undefined): number {
  if (!Number.isFinite(attempts ?? NaN)) {
    return DEFAULT_AUTO_ATTEMPTS;
  }
  const value = Math.floor(attempts as number);
  return Math.min(Math.max(value, 1), MAX_AUTO_ATTEMPTS);
}

/**
 * The ordered $0 candidates for cloud mode. A provider whose credential the
 * server does not hold is skipped rather than attempted and failed, and the list
 * is truncated to the configured bound so one turn cannot walk the whole catalog.
 */
function autoCandidates(
  hasEnv: (name: string) => boolean,
  attempts: number | undefined,
): ModelCandidate[] {
  const candidates: ModelCandidate[] = [];
  if (hasEnv(OPENROUTER_API_KEY_ENV)) {
    for (const modelId of OPENROUTER_FREE_MODEL_IDS) {
      candidates.push({
        model: { providerId: 'openrouter', modelId },
        requireEnv: OPENROUTER_API_KEY_ENV,
      });
    }
  }
  for (const modelId of OPENCODE_FREE_MODEL_IDS) {
    candidates.push({ model: { providerId: OPENCODE_FREE_PROVIDER, modelId } });
  }
  const usable = candidates.filter((candidate) =>
    candidate.requireEnv ? hasEnv(candidate.requireEnv) : true,
  );
  return usable.slice(0, bounded(attempts));
}

/**
 * Resolve the configured model setting into either one pinned candidate or an
 * ordered automatic plan. A pinned model that fails the $0 policy yields no
 * candidates and an explanation, never a paid default.
 */
export function resolveModelPlan(input: {
  configured: string | undefined | null;
  mode: 'private' | 'cloud';
  hasEnv?: (name: string) => boolean;
  maxAttempts?: number;
}): ModelPlan {
  const configured = (input.configured ?? '').trim();
  if (configured.toLowerCase() === AUTO_MODEL) {
    if (input.mode === 'private') {
      return { auto: true, candidates: [], detail: PRIVATE_AUTO_DETAIL };
    }
    const candidates = autoCandidates(input.hasEnv ?? (() => false), input.maxAttempts);
    return candidates.length > 0
      ? { auto: true, candidates }
      : {
          auto: true,
          candidates: [],
          detail:
            `${OPENROUTER_API_KEY_ENV} is not set, so no verified $0 hosted model ` +
            'can run this task.',
        };
  }
  const model = parseEngineModel(configured);
  if (!isModelAllowedForMode(model, input.mode) || !model) {
    return {
      auto: false,
      candidates: [],
      detail:
        input.mode === 'private' && model?.providerId === 'opencode'
          ? PRIVATE_MODEL_DETAIL
          : ZERO_COST_MODEL_DETAIL,
    };
  }
  return { auto: false, candidates: [{ model }] };
}
