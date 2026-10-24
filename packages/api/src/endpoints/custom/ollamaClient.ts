import { z } from 'zod';
import axios from 'axios';
import { Ollama } from 'ollama';
import { sleep } from '@librechat/agents';
import { logger } from '@coderax/data-schemas';
import { Constants } from 'coderax-data-provider';
import type { AbortableAsyncIterator, ChatResponse, Message } from 'ollama';
import type { IUser } from '@coderax/data-schemas';
import { resolveHeaders, deriveBaseURL } from '~/utils';

interface OllamaChatParameters {
  mirostat?: number;
  mirostat_eta?: number;
  mirostat_tau?: number;
  num_ctx?: number;
  repeat_last_n?: number;
  repeat_penalty?: number;
  temperature?: number;
  seed?: number | null;
  stop?: string[];
  tfs_z?: number;
  num_predict?: number;
  top_k?: number;
  top_p?: number;
  stream?: boolean;
  model: string;
}

export const ollamaPayloadSchema: z.ZodType<OllamaChatParameters> = z.object({
  mirostat: z.number().optional(),
  mirostat_eta: z.number().optional(),
  mirostat_tau: z.number().optional(),
  num_ctx: z.number().optional(),
  repeat_last_n: z.number().optional(),
  repeat_penalty: z.number().optional(),
  temperature: z.number().optional(),
  seed: z.number().nullable().optional(),
  stop: z.array(z.string()).optional(),
  tfs_z: z.number().optional(),
  num_predict: z.number().optional(),
  top_k: z.number().optional(),
  top_p: z.number().optional(),
  stream: z.boolean().optional(),
  model: z.string(),
});

type InputMessagePart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

type InputMessage = {
  role: string;
  content: string | InputMessagePart[];
};

export type OllamaChatPayload = OllamaChatParameters & {
  messages: InputMessage[];
};

type OllamaStreamResponse = AbortableAsyncIterator<ChatResponse> & {
  controller?: { abort?: () => void };
};

export interface OllamaClientOptions {
  baseURL?: string;
  streamRate?: number;
}

/** Extract the base64 payload from an OpenAI-compatible data URL. */
function getValidBase64(imageUrl: string): string | undefined {
  const parts = imageUrl.split(';base64,');
  if (parts.length === 2) {
    return parts[1];
  }
  logger.error('Invalid or no Base64 string found in URL.');
  return undefined;
}

export class OllamaClient {
  private readonly streamRate: number;
  private readonly host: string;

  constructor(options: OllamaClientOptions = {}) {
    this.host = deriveBaseURL(options.baseURL ?? 'http://localhost:11434');
    this.streamRate = options.streamRate ?? Constants.DEFAULT_STREAM_RATE;
  }

  /** Create one SDK client per completion so cancellation is isolated to that request. */
  private createClient(signal?: AbortSignal): Ollama {
    if (!signal) {
      return new Ollama({ host: this.host });
    }

    const fetchWithSignal: typeof fetch = (input, init) => {
      const requestSignal = init?.signal;
      return fetch(input, {
        ...init,
        signal: requestSignal ? AbortSignal.any([requestSignal, signal]) : signal,
      });
    };

    return new Ollama({ host: this.host, fetch: fetchWithSignal });
  }

  /** Fetch model names without forwarding resolved headers across a redirect. */
  static async fetchModels(
    baseURL: string,
    options: { user?: Partial<IUser>; headers?: Record<string, string> | null } = {},
  ): Promise<string[]> {
    if (!baseURL) {
      return [];
    }

    const ollamaEndpoint = deriveBaseURL(baseURL);
    const resolvedHeaders = resolveHeaders({
      headers: options.headers ?? undefined,
      user: options.user,
    });
    const response = await axios.get<{ models: Array<{ name: string }> }>(
      `${ollamaEndpoint}/api/tags`,
      {
        headers: resolvedHeaders,
        timeout: 5000,
        maxRedirects: 0,
      },
    );

    return response.data.models.map((tag) => tag.name);
  }

  static formatOpenAIMessages(messages: InputMessage[]): Message[] {
    const ollamaMessages: Message[] = [];

    for (const message of messages) {
      if (typeof message.content === 'string') {
        ollamaMessages.push({ role: message.role, content: message.content });
        continue;
      }

      let aggregatedText = '';
      const imageUrls: string[] = [];
      for (const content of message.content) {
        if (content.type === 'text') {
          aggregatedText += `${content.text} `;
        } else if (content.type === 'image_url') {
          const image = getValidBase64(content.image_url.url);
          if (image) {
            imageUrls.push(image);
          }
        }
      }

      const ollamaMessage: Message = {
        role: message.role,
        content: aggregatedText.trim(),
      };
      if (imageUrls.length > 0) {
        ollamaMessage.images = imageUrls;
      }
      ollamaMessages.push(ollamaMessage);
    }

    return ollamaMessages;
  }

  async chatCompletion({
    payload,
    onProgress = () => {},
    abortController = null,
  }: {
    payload: OllamaChatPayload;
    onProgress?: (token: string) => void;
    abortController?: AbortController | null;
  }): Promise<string> {
    let intermediateReply = '';
    const signal = abortController?.signal;

    try {
      const { stream: isStreaming, ...parameters } = ollamaPayloadSchema.parse(payload);
      const messages = OllamaClient.formatOpenAIMessages(payload.messages);

      if (signal?.aborted) {
        return intermediateReply;
      }

      const client = this.createClient(signal);

      if (isStreaming !== true) {
        const response = await client.chat({ ...parameters, messages, stream: false });
        if (signal?.aborted) {
          return intermediateReply;
        }

        const content = response?.message?.content;
        if (typeof content === 'string') {
          intermediateReply = content;
          if (content.length > 0) {
            onProgress(content);
          }
        }
        return intermediateReply;
      }

      const response = (await client.chat({
        ...parameters,
        messages,
        stream: true,
      })) as OllamaStreamResponse;
      let streamAborted = false;
      const abortStream = () => {
        if (streamAborted) {
          return;
        }
        streamAborted = true;
        if (typeof response.abort === 'function') {
          response.abort();
        } else {
          response.controller?.abort?.();
        }
      };

      if (signal?.aborted) {
        abortStream();
        return intermediateReply;
      }

      signal?.addEventListener('abort', abortStream, { once: true });
      try {
        for await (const chunk of response) {
          if (signal?.aborted) {
            abortStream();
            break;
          }

          const token = chunk.message?.content ?? '';
          if (token.length > 0) {
            intermediateReply += token;
            onProgress(token);
          }

          if (signal?.aborted) {
            abortStream();
            break;
          }
          await sleep(this.streamRate);
        }
        return intermediateReply;
      } finally {
        signal?.removeEventListener('abort', abortStream);
      }
    } catch (error) {
      if (signal?.aborted) {
        return intermediateReply;
      }
      logger.error('[OllamaClient.chatCompletion]', error);
      throw error;
    }
  }
}
