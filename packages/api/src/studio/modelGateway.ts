import { STUDIO_ALLOWED_EXTENSIONS, STUDIO_LIMITS, StudioGenerationError } from './types';
import type { StudioGenerationRequest, StudioGenerationResult, StudioGenerator } from './types';

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

function chatCompletionsUrl(rawBaseUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawBaseUrl);
  } catch {
    throw new StudioGenerationError('NOT_CONFIGURED', 'Invalid ModelGateway URL');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new StudioGenerationError('NOT_CONFIGURED', 'Invalid ModelGateway URL');
  }

  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = /\/chat\/completions$/i.test(path) ? path : `${path}/chat/completions`;
  return url.toString();
}

/** Accepts plain JSON or one fenced JSON block; output validation stays in the handler. */
function parseModelJson(content: string): unknown {
  const fenced = content.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  try {
    return JSON.parse(fenced?.[1] ?? content);
  } catch {
    throw new StudioGenerationError('INVALID_OUTPUT', 'Model response was not valid JSON');
  }
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new StudioGenerationError('INVALID_OUTPUT', 'Model response exceeded the size limit');
  }

  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new StudioGenerationError('INVALID_OUTPUT', 'Model response exceeded the size limit');
    }
    return text;
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new StudioGenerationError('INVALID_OUTPUT', 'Model response exceeded the size limit');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function responseContent(rawResponse: string): string {
  let envelope: unknown;
  try {
    envelope = JSON.parse(rawResponse);
  } catch {
    throw new StudioGenerationError('UPSTREAM_ERROR', 'ModelGateway returned an invalid response');
  }
  const choices = (envelope as { choices?: unknown } | null)?.choices;
  const firstChoice = Array.isArray(choices) ? choices[0] : undefined;
  const message = (firstChoice as { message?: unknown } | undefined)?.message;
  const content = (message as { content?: unknown } | null)?.content;
  if (typeof content !== 'string') {
    throw new StudioGenerationError('INVALID_OUTPUT', 'Model response did not contain text');
  }
  return content;
}

export function createModelGatewayStudioGenerator(
  options: ModelGatewayStudioOptions,
): StudioGenerator {
  const endpoint = chatCompletionsUrl(options.baseUrl);
  const model = options.model.trim();
  if (!model) throw new StudioGenerationError('NOT_CONFIGURED', 'Model is required');
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0) {
    throw new RangeError('maxResponseBytes must be a positive safe integer');
  }
  const fetcher = options.fetch ?? fetch;

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
        if (options.apiKey?.trim()) headers.authorization = `Bearer ${options.apiKey.trim()}`;

        let response: Response;
        try {
          response = await fetcher(endpoint, {
            method: 'POST',
            headers,
            signal: controller.signal,
            body: JSON.stringify({
              model,
              messages: [
                { role: 'system', content: STUDIO_SYSTEM_PROMPT },
                { role: 'user', content: request.prompt },
              ],
              temperature: 0.2,
            }),
          });
        } catch {
          if (timedOut) throw new StudioGenerationError('TIMEOUT');
          throw new StudioGenerationError('UPSTREAM_ERROR');
        }

        if (!response.ok) throw new StudioGenerationError('UPSTREAM_ERROR');

        let rawResponse: string;
        try {
          rawResponse = await readBoundedText(response, maxResponseBytes);
        } catch (error) {
          if (error instanceof StudioGenerationError) throw error;
          if (timedOut) throw new StudioGenerationError('TIMEOUT');
          throw new StudioGenerationError('UPSTREAM_ERROR');
        }

        return parseModelJson(responseContent(rawResponse)) as StudioGenerationResult;
      } finally {
        clearTimeout(timeout);
        request.signal.removeEventListener('abort', abortFromRequest);
      }
    },
  };
}

export function createModelGatewayStudioGeneratorFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): StudioGenerator | null {
  const baseUrl = env.STUDIO_MODEL_GATEWAY_URL?.trim();
  const model = env.STUDIO_MODEL?.trim();
  if (!baseUrl || !model) return null;

  try {
    return createModelGatewayStudioGenerator({
      baseUrl,
      model,
      apiKey: env.STUDIO_MODEL_GATEWAY_API_KEY?.trim() || undefined,
    });
  } catch (error) {
    if (error instanceof StudioGenerationError && error.code === 'NOT_CONFIGURED') return null;
    throw error;
  }
}
