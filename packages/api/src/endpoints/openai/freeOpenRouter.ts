import {
  FREE_ENDPOINTS,
  FREE_OPENROUTER_URL,
  isFreeOpenRouterModel,
  DEFAULT_FREE_INFERENCE_OPENROUTER_MAX_OUTPUT_TOKENS,
} from 'coderax-data-provider';
import type { fetch as undiciFetch } from 'undici';
import type { FreeInferenceBudget } from '~/routing/budget';
import { FreeInferenceBudgetExceededError } from '~/routing/budget';

const completionURL = `${FREE_OPENROUTER_URL}/chat/completions`;
const FREE_OPENROUTER_MODEL_IDS = FREE_ENDPOINTS.filter(
  (endpoint) => endpoint.provider === 'openrouter' && isFreeOpenRouterModel(endpoint.modelId),
).map((endpoint) => endpoint.modelId);
// Forward only native chat fields. OpenRouter-specific plugins, alternate models
// and provider preferences must never come from agent or request parameters.
const chatFields = [
  'model',
  'messages',
  'stream',
  'stream_options',
  'tools',
  'tool_choice',
  'parallel_tool_calls',
  'temperature',
  'top_p',
  'frequency_penalty',
  'presence_penalty',
  'stop',
  'seed',
  'response_format',
  'reasoning',
] as const;

/**
 * Conservative prompt estimate: the routing planner uses the same heuristic
 * for a turn's reservation. Prompt text is what the caller controls before the
 * call; measured usage reconciles it afterwards when the provider reports it.
 */
function estimatePromptTokens(messages: unknown): number {
  try {
    const serialized = JSON.stringify(messages);
    return serialized == null ? 0 : Math.max(1, Math.ceil(serialized.length / 4));
  } catch {
    return 0;
  }
}

type FreeOpenRouterResponse = Awaited<ReturnType<typeof undiciFetch>>;

/**
 * Measured tokens for a completed non-streaming completion. A declined request
 * consumed nothing, so its token reservation is released. A streaming or
 * unparseable response returns `null`, which keeps the reservation in place.
 */
async function measuredTokens(response: FreeOpenRouterResponse): Promise<number | null> {
  if (!response.ok) {
    return 0;
  }
  try {
    if (!(response.headers.get('content-type') ?? '').includes('application/json')) {
      return null;
    }
    const body = (await response.clone().json()) as {
      usage?: { total_tokens?: unknown; prompt_tokens?: unknown; completion_tokens?: unknown };
    } | null;
    const usage = body?.usage;
    if (!usage) {
      return null;
    }
    if (Number.isSafeInteger(usage.total_tokens) && (usage.total_tokens as number) >= 0) {
      return usage.total_tokens as number;
    }
    if (Number.isSafeInteger(usage.prompt_tokens) && (usage.prompt_tokens as number) >= 0) {
      const completion =
        Number.isSafeInteger(usage.completion_tokens) && (usage.completion_tokens as number) >= 0
          ? (usage.completion_tokens as number)
          : 0;
      return (usage.prompt_tokens as number) + completion;
    }
    return null;
  } catch {
    return null;
  }
}

export function createFreeOpenRouterFetch(
  send: typeof undiciFetch,
  maxOutputTokens = DEFAULT_FREE_INFERENCE_OPENROUTER_MAX_OUTPUT_TOKENS,
  budget?: FreeInferenceBudget,
): typeof undiciFetch {
  return async (input, init) => {
    if (
      String(input) !== completionURL ||
      init?.method?.toUpperCase() !== 'POST' ||
      typeof init.body !== 'string'
    ) {
      throw new Error('Invalid free OpenRouter request.');
    }

    const body = JSON.parse(init.body);
    if (!isFreeOpenRouterModel(body?.model) || !Array.isArray(body.messages)) {
      throw new Error('The selected free OpenRouter model is unavailable.');
    }
    if (
      body.tools !== undefined &&
      (!Array.isArray(body.tools) ||
        body.tools.some((tool: { type?: string } | null) => tool?.type !== 'function'))
    ) {
      throw new Error('Only function tools are supported by the free OpenRouter endpoint.');
    }

    for (const message of body.messages) {
      const content = message?.content;
      if (
        content != null &&
        typeof content !== 'string' &&
        (!Array.isArray(content) ||
          content.some((part) => part?.type !== 'text' && part?.type !== 'image_url'))
      ) {
        throw new Error('Unsupported content for the free OpenRouter endpoint.');
      }
    }

    const payload: Record<string, unknown> = {};
    for (const field of chatFields) {
      if (Object.prototype.hasOwnProperty.call(body, field)) {
        payload[field] = body[field];
      }
    }
    const requestedLimit = body.max_completion_tokens ?? body.max_tokens;
    payload.max_tokens =
      Number.isSafeInteger(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, maxOutputTokens)
        : maxOutputTokens;
    // Model-level fallback remains within the exact, verified free allowlist.
    // Provider-level fallback is disabled below; the data policy is applied to
    // every model attempt, including alternatives.
    payload.models = FREE_OPENROUTER_MODEL_IDS.filter((id) => id !== body.model);
    payload.provider = {
      require_parameters: true,
      allow_fallbacks: false,
      data_collection: 'deny',
      zdr: true,
      max_price: { prompt: 0, completion: 0, request: 0, image: 0 },
    };

    // The daily budget is enforced here, at the only place a free completion
    // can leave the process. A stale or forged earlier plan cannot bypass it.
    const admission = budget?.admit(estimatePromptTokens(payload.messages));
    const granted = admission?.ok === true ? admission : null;
    if (admission && !admission.ok) {
      throw new FreeInferenceBudgetExceededError(admission.reason);
    }

    let response: FreeOpenRouterResponse;
    try {
      response = await send(completionURL, {
        ...init,
        body: JSON.stringify(payload),
        redirect: 'error',
      });
    } catch (error) {
      if (granted && budget) {
        budget.settle(0, granted.reservedTokens, granted.resetAt);
      }
      throw error;
    }

    if (granted && budget) {
      const used = await measuredTokens(response);
      if (used != null) {
        budget.settle(used, granted.reservedTokens, granted.resetAt);
      }
    }
    return response;
  };
}
