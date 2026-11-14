import { STUDIO_ALLOWED_EXTENSIONS, STUDIO_LIMITS, StudioGenerationError } from './types';
import type { StudioGenerationResult, StudioGenerator } from './types';

/** Upper bound on the raw gateway response, before JSON parsing. */
const DEFAULT_MAX_RESPONSE_BYTES = STUDIO_LIMITS.maxTotalBytes * 2;

export const STUDIO_SYSTEM_PROMPT: string = [
  'You generate small static web projects.',
  'Respond with ONLY a JSON object of the form',
  '{"title": string, "entry": string, "files": [{"path": string, "content": string}]}.',
  '`entry` must be an .html file that is also listed in `files`.',
  'Paths are relative, use forward slashes, and never start with "." or contain "..".',
  `Allowed extensions: ${STUDIO_ALLOWED_EXTENSIONS.join(', ')}.`,
  `At most ${STUDIO_LIMITS.maxFiles} files.`,
  'Link stylesheets with <link rel="stylesheet" href="...">. Scripts will NOT run in the preview,',
  'so the page must be fully usable as HTML and CSS. Do not load remote resources.',
  'Use clearly labelled sample data; never include secrets or real personal data.',
].join(' ');

export type ModelGatewayStudioOptions = {
  /** OpenAI-compatible base URL, e.g. https://gateway.internal/v1 */
  baseUrl: string;
  apiKey?: string;
  model: string;
  fetch?: typeof fetch;
  maxResponseBytes?: number;
};

/** Accepts plain JSON or a single ```json fenced block. */
function parseModelJson(content: string): unknown {
  const trimmed = content.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  try {
    return JSON.parse(match?.[1] ?? trimmed);
  } catch {
    throw new StudioGenerationError('INVALID_OUTPUT');
  }
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new StudioGenerationError('INVALID_OUTPUT');
  }

  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new StudioGenerationError('INVALID_OUTPUT');
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new StudioGenerationError('INVALID_OUTPUT');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
}

/** Creates a server-side generator for an OpenAI-compatible chat-completions gateway. */
export function createModelGatewayStudioGenerator(
  options: ModelGatewayStudioOptions,
): StudioGenerator {
  const fetcher = options.fetch ?? globalThis.fetch;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const endpoint = `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  return {
    async generate(request: StudioGenerationRequest): Promise<StudioGenerationResult> {
      const controller = new AbortController();
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, STUDIO_LIMITS.timeoutMs);
      const abortFromRequest = () => controller.abort();
      if (request.signal.aborted) controller.abort();
      else request.signal.addEventListener('abort', abortFromRequest, { once: true });

      try {
        const headers: Record<string, string> = { 'content-type': 'application/json' };
        if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`;
        const response = await fetcher(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: options.model,
            messages: [
              { role: 'system', content: STUDIO_SYSTEM_PROMPT },
              { role: 'user', content: request.prompt },
            ],
            temperature: 0.2,
          }),
          signal: controller.signal,
        });
        if (!response.ok) throw new StudioGenerationError('UPSTREAM_ERROR');

        let envelope: unknown;
        try {
          envelope = JSON.parse(await readBoundedText(response, maxResponseBytes));
        } catch (error) {
          if (error instanceof StudioGenerationError) throw error;
          throw new StudioGenerationError('UPSTREAM_ERROR');
        }

        const content = (envelope as {
          choices?: Array<{ message?: { content?: unknown } }>;
        } | null)?.choices?.[0]?.message?.content;
        if (typeof content !== 'string') throw new StudioGenerationError('INVALID_OUTPUT');
        return validateStudioOutput(parseModelJson(content));
      } catch (error) {
        if (error instanceof StudioGenerationError) throw error;
        if (timedOut) throw new StudioGenerationError('TIMEOUT');
        throw new StudioGenerationError('UPSTREAM_ERROR');
      } finally {
        clearTimeout(timeout);
        request.signal.removeEventListener('abort', abortFromRequest);
      }
    },
  };
}

/** Returns null until both the private gateway URL and model are configured. */
export function createModelGatewayStudioGeneratorFromEnv(
  env: Record<string, string | undefined> = process.env,
): StudioGenerator | null {
  const baseUrl = env.STUDIO_MODEL_GATEWAY_URL?.trim();
  const model = env.STUDIO_MODEL?.trim();
  if (!baseUrl || !model) return null;

  const apiKey = env.STUDIO_MODEL_GATEWAY_API_KEY?.trim();
  return createModelGatewayStudioGenerator({
    baseUrl,
    model,
    ...(apiKey ? { apiKey } : {}),
  });
}
