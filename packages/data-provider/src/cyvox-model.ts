export function isCyvoxFreeOrLocalModel(model: string): boolean {
  return (
    model === 'cyvox/auto' ||
    model === 'openrouter/free' ||
    /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*:free$/.test(model) ||
    /^ollama[:/][A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*(?::[A-Za-z0-9._-]+)?$/.test(model)
  );
}

/**
 * Mirrors `cyvox/model_selection.THINKING_EFFORT_PROFILES`. CyVox stays
 * authoritative; sharing the list keeps the bridge and the task composer from
 * drifting apart as profiles change.
 */
export const CYVOX_THINKING_EFFORTS = ['instant', 'medium', 'high', 'extra_high'] as const;

export type CyvoxThinkingEffort = (typeof CYVOX_THINKING_EFFORTS)[number];

export function isCyvoxThinkingEffort(value: string): value is CyvoxThinkingEffort {
  return (CYVOX_THINKING_EFFORTS as readonly string[]).includes(value);
}
