import {
  FREE_OPENROUTER_URL,
  isFreeOpenRouterModel,
  DEFAULT_FREE_INFERENCE_OPENROUTER_MAX_OUTPUT_TOKENS,
} from 'coderax-data-provider';
import type { fetch as undiciFetch } from 'undici';

const completionURL = `${FREE_OPENROUTER_URL}/chat/completions`;
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

export function createFreeOpenRouterFetch(
  send: typeof undiciFetch,
  maxOutputTokens = DEFAULT_FREE_INFERENCE_OPENROUTER_MAX_OUTPUT_TOKENS,
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
    payload.provider = {
      require_parameters: true,
      max_price: { prompt: 0, completion: 0, request: 0, image: 0 },
    };

    return send(completionURL, { ...init, body: JSON.stringify(payload), redirect: 'error' });
  };
}
