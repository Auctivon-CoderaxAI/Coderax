import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_HOST = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'qwen3.5:4b';
const MAX_REPLY_CHARS = 100_000;

export function localOllamaOrigin(host = DEFAULT_HOST) {
  const url = new URL(host);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'];
  if (
    url.protocol !== 'http:' ||
    !loopback.includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Ollama readiness checks require a local HTTP loopback endpoint');
  }
  return url.origin;
}

async function readJson(fetchImpl, url, options) {
  const response = await fetchImpl(url, { ...options, redirect: 'error' });
  if (!response.ok) {
    throw new Error(`Local Ollama returned HTTP ${response.status}`);
  }
  return response.json();
}

function isAbortError(error) {
  return error?.name === 'AbortError' || error?.name === 'TimeoutError';
}

function parseChatLine(line) {
  let chunk;
  try {
    chunk = JSON.parse(line);
  } catch {
    throw new Error('Local Ollama chat returned a malformed stream chunk');
  }
  if (chunk && typeof chunk.error === 'string' && chunk.error.length > 0) {
    throw new Error('Local Ollama chat returned an error chunk');
  }
  return chunk;
}

/**
 * Reads Ollama's newline-delimited `/api/chat` stream and requires proof that
 * the model actually produced content: at least one nonempty delta, a terminal
 * `done: true` chunk, and the requested model identity. A 200 response alone is
 * not readiness, and a non-streaming reply does not exercise the SSE path.
 */
async function readChatStream(fetchImpl, url, options, model) {
  let response;
  try {
    response = await fetchImpl(url, { ...options, redirect: 'error' });
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error('Local Ollama readiness check timed out');
    }
    throw error;
  }
  if (!response.ok) {
    throw new Error(`Local Ollama returned HTTP ${response.status}`);
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    throw new Error('Local Ollama chat returned no stream');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const consume = (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    const chunk = parseChatLine(trimmed);
    if (typeof chunk.model === 'string' && chunk.model.length > 0) {
      responseModel = chunk.model;
    }
    const delta = chunk.message?.content;
    if (typeof delta === 'string' && delta.length > 0) {
      content += delta;
    }
    if (chunk.done === true) {
      done = true;
    }
  };

  let buffered = '';
  let content = '';
  let done = false;
  let responseModel;
  try {
    while (!done) {
      const next = await reader.read();
      if (next.done) {
        break;
      }
      buffered += decoder.decode(next.value, { stream: true });
      let newline;
      while (!done && (newline = buffered.indexOf('\n')) !== -1) {
        consume(buffered.slice(0, newline));
        buffered = buffered.slice(newline + 1);
      }
    }
    if (!done) {
      buffered += decoder.decode();
      consume(buffered);
    }
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error('Local Ollama readiness check timed out');
    }
    throw error;
  } finally {
    reader.releaseLock?.();
  }

  if (content.length > MAX_REPLY_CHARS) {
    throw new Error('Local Ollama chat reply exceeded the maximum size');
  }
  if (!content.trim()) {
    throw new Error('Local Ollama chat returned an empty reply');
  }
  if (!done) {
    throw new Error('Local Ollama chat did not finish');
  }
  if (responseModel !== model) {
    throw new Error('Local Ollama chat returned a different model');
  }
  return content;
}

/**
 * Verify that the locally installed Ollama model is listed and streams a chat
 * reply. No cloud provider, account, or API key is used.
 */
export async function checkLocalOllama({
  host = DEFAULT_HOST,
  model = DEFAULT_MODEL,
  fetchImpl = globalThis.fetch,
  timeoutMs = 15000,
} = {}) {
  const origin = localOllamaOrigin(host);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
    throw new Error('timeoutMs must be between 1 and 120000');
  }

  const signal = AbortSignal.timeout(timeoutMs);
  const tags = await readJson(fetchImpl, `${origin}/api/tags`, { signal });
  if (!Array.isArray(tags.models) || !tags.models.some((item) => item.name === model)) {
    throw new Error(`Required local model ${model} is not installed`);
  }

  await readChatStream(
    fetchImpl,
    `${origin}/api/chat`,
    {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with LOCAL_OK.' }],
        stream: true,
        think: false,
        options: { num_predict: 32 },
      }),
    },
    model,
  );

  return { status: 'ready', model, origin };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkLocalOllama({ host: process.env.CODERAX_OLLAMA_HOST || DEFAULT_HOST })
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(`Coderax local Ollama readiness failed: ${error.message}`);
      process.exitCode = 1;
    });
}
