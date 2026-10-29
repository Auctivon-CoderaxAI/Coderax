/**
 * Fireworks GLM 5.3 Flash — opt-in BYOK custom endpoint preset.
 *
 * Fireworks is a paid, metered provider. This module therefore ships a
 * *description* of an endpoint, never an enabled one: `buildFireworksGlmEndpoint`
 * returns `null` unless an API key is present in the environment, so importing
 * or exporting this file cannot, on its own, put a billable provider into
 * anybody's configuration. Enabling it is a deliberate act with a key.
 *
 * The model path is `accounts/fireworks/models/glm-5p3-flash`. Fireworks slugs
 * cannot contain dots, so "GLM 5.3" is encoded as "glm-5p3"; writing
 * "glm-5.3-flash" yields a 404. `toFireworksModelPath` encodes that rule so
 * callers cannot introduce the bad spelling by hand.
 */

export const FIREWORKS_INFERENCE_BASE_URL = 'https://api.fireworks.ai/inference/v1';

export const FIREWORKS_API_KEY_ENV = 'FIREWORKS_API_KEY';

export const GLM_5P3_FLASH_SLUG = 'glm-5p3-flash';

export const GLM_5P3_FLASH_MODEL_PATH = 'accounts/fireworks/models/glm-5p3-flash';

/**
 * Declared capabilities, verified against the provider's model card:
 * 320B total / 18B active, natively multimodal, 1,048,573-token context and
 * 131,072 max output.
 */
export const GLM_5P3_FLASH_CAPABILITIES = {
  vision: true,
  toolCalls: true,
  streaming: true,
  contextWindow: 1048573,
  maxOutputTokens: 131072,
} as const;

export interface FireworksGlmModel {
  /** Display name shown in the model selector. */
  name: string;
  /** The exact Fireworks account path; never a bare slug. */
  model: string;
  capabilities: typeof GLM_5P3_FLASH_CAPABILITIES;
}

export interface FireworksGlmEndpointPreset {
  name: string;
  baseURL: string;
  /** Present only because the caller supplied a key. */
  apiKey: string;
  provider: 'fireworks';
  /** Marks the endpoint as bring-your-own-key in the UI. */
  requiresApiKey: true;
  /** Never part of a default configuration. */
  enablement: 'opt-in';
  models: FireworksGlmModel[];
}

type EnvLike = Record<string, string | undefined>;

function readEnv(name: string, env?: EnvLike): string | undefined {
  const source = env ?? (typeof process !== 'undefined' ? process.env : undefined);
  const value = source?.[name];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Encodes a Fireworks slug into its account path. Dots are illegal in slugs,
 * so they map to `p`: `glm-5.3-flash` and `glm-5p3-flash` both resolve to
 * `accounts/fireworks/models/glm-5p3-flash`.
 */
export function toFireworksModelPath(slug: string): string {
  const trimmed = slug.trim();
  if (!trimmed) {
    throw new Error('A Fireworks model slug or path is required.');
  }
  if (trimmed.startsWith('accounts/')) {
    return trimmed;
  }
  const encoded = trimmed.replace(/\./g, 'p');
  return `accounts/fireworks/models/${encoded}`;
}

/** True only for the exact account path; bare slugs and dotted slugs fail. */
export function isFireworksGlmModelPath(value: string): boolean {
  return value.trim() === GLM_5P3_FLASH_MODEL_PATH;
}

/** Returns the key only when it is non-blank, so `'   '` counts as absent. */
export function resolveFireworksApiKey(env?: EnvLike): string | null {
  const raw = readEnv(FIREWORKS_API_KEY_ENV, env);
  if (typeof raw !== 'string') {
    return null;
  }
  const key = raw.trim();
  return key.length > 0 ? key : null;
}

/** Cheap gate for UI code that wants to show or hide the Fireworks option. */
export function isFireworksGlmEnabled(env?: EnvLike): boolean {
  return resolveFireworksApiKey(env) !== null;
}

/**
 * Builds the custom endpoint, or returns `null` when no key is configured.
 *
 * Returning `null` rather than an endpoint with an empty key is deliberate:
 * an endpoint with a blank key would still appear in the model list and fail
 * at request time, which reads to a user as a broken product rather than an
 * unconfigured integration.
 */
export function buildFireworksGlmEndpoint(env?: EnvLike): FireworksGlmEndpointPreset | null {
  const apiKey = resolveFireworksApiKey(env);
  if (!apiKey) {
    return null;
  }
  return {
    name: 'Fireworks — GLM 5.3 Flash (BYOK)',
    baseURL: FIREWORKS_INFERENCE_BASE_URL,
    apiKey,
    provider: 'fireworks',
    requiresApiKey: true,
    enablement: 'opt-in',
    models: [
      {
        name: 'GLM 5.3 Flash',
        model: GLM_5P3_FLASH_MODEL_PATH,
        capabilities: GLM_5P3_FLASH_CAPABILITIES,
      },
    ],
  };
}
