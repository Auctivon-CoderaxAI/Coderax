import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_HOST = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'qwen3.5:4b';

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
  const response = await fetchImpl(url, options);
  if (!response.ok) {
    throw new Error(`Local Ollama returned HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Verify that the locally installed Ollama model is listed and answers a chat
 * request. No cloud provider, account, or API key is used.
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

  const reply = await readJson(fetchImpl, `${origin}/api/chat`, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'Reply with LOCAL_OK.' }],
      stream: false,
      options: { num_predict: 32 },
    }),
  });

  if (typeof reply.message?.content !== 'string' || !reply.message.content.trim()) {
    throw new Error('Local Ollama chat returned an empty reply');
  }
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
