const { z } = require('zod');
const axios = require('axios');
const { Ollama } = require('ollama');
const { sleep } = require('@librechat/agents');
const { logger } = require('@coderax/data-schemas');
const { Constants } = require('coderax-data-provider');
const { resolveHeaders, deriveBaseURL } = require('@coderax/api');

const ollamaPayloadSchema = z.object({
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
  stream: z.optional(z.boolean()),
  model: z.string(),
});

/**
 * @param {string} imageUrl
 * @returns {string}
 * @throws {Error}
 */
const getValidBase64 = (imageUrl) => {
  const parts = imageUrl.split(';base64,');

  if (parts.length === 2) {
    return parts[1];
  } else {
    logger.error('Invalid or no Base64 string found in URL.');
  }
};

class OllamaClient {
  constructor(options = {}) {
    const host = deriveBaseURL(options.baseURL ?? 'http://localhost:11434');
    this.streamRate = options.streamRate ?? Constants.DEFAULT_STREAM_RATE;
    this.headers = options.headers ?? {};
    /** @type {Ollama} */
    this.client = new Ollama({ host });
  }

  /**
   * Fetches Ollama models from the specified base API path.
   * @param {string} baseURL
   * @param {Object} [options] - Optional configuration
   * @param {Partial<IUser>} [options.user] - User object for header resolution
   * @param {Record<string, string>} [options.headers] - Headers to include in the request
   * @returns {Promise<string[]>} The Ollama models.
   * @throws {Error} Throws if the Ollama API request fails
   */
  static async fetchModels(baseURL, options = {}) {
    if (!baseURL) {
      return [];
    }

    const ollamaEndpoint = deriveBaseURL(baseURL);

    const resolvedHeaders = resolveHeaders({
      headers: options.headers,
      user: options.user,
    });

    /** @type {Promise<AxiosResponse<OllamaListResponse>>} */
    const response = await axios.get(`${ollamaEndpoint}/api/tags`, {
      headers: resolvedHeaders,
      timeout: 5000,
      maxRedirects: 0,
    });

    const models = response.data.models.map((tag) => tag.name);
    return models;
  }

  /**
   * @param {ChatCompletionMessage[]} messages
   * @returns {OllamaMessage[]}
   */
  static formatOpenAIMessages(messages) {
    const ollamaMessages = [];

    for (const message of messages) {
      if (typeof message.content === 'string') {
        ollamaMessages.push({
          role: message.role,
          content: message.content,
        });
        continue;
      }

      let aggregatedText = '';
      let imageUrls = [];

      for (const content of message.content) {
        if (content.type === 'text') {
          aggregatedText += content.text + ' ';
        } else if (content.type === 'image_url') {
          imageUrls.push(getValidBase64(content.image_url.url));
        }
      }

      const ollamaMessage = {
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

  /***
   * @param {Object} params
   * @param {ChatCompletionPayload} params.payload
   * @param {onTokenProgress} params.onProgress
   * @param {AbortController} [params.abortController]
   */
  async chatCompletion({ payload, onProgress, abortController = null }) {
    let intermediateReply = '';

    try {
      const parameters = ollamaPayloadSchema.parse(payload);
      const messages = OllamaClient.formatOpenAIMessages(payload.messages);
      const isStreaming = parameters.stream === true;

      // Do not start a local inference request when its caller has already cancelled it.
      if (abortController?.signal?.aborted) {
        return intermediateReply;
      }

      const response = await this.client.chat({
        messages,
        ...parameters,
        stream: isStreaming,
      });

      if (!isStreaming) {
        if (abortController?.signal?.aborted) {
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
      const signal = abortController?.signal;

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
    } catch (err) {
      logger.error('[OllamaClient.chatCompletion]', err);
      throw err;
    }
  }
}

module.exports = { OllamaClient, ollamaPayloadSchema };
