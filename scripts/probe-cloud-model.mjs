#!/usr/bin/env node
/**
 * One-shot private inference smoke test; intended to run INSIDE the cloud API
 * container after 'ollama pull qwen3.5:4b'. No provider key or cloud account.
 * Exits nonzero when the model is unavailable or does not answer correctly.
 * It never prints credentials, response text, or upstream error bodies.
 */
const base = process.env.CODERAX_MODEL_BASE_URL || 'http://ollama:11434/v1/';
const model = process.env.CODERAX_MODEL_ID || 'qwen3.5:4b';
const token = process.env.CODERAX_MODEL_INTERNAL_TOKEN;

async function main() {
  const url = new URL(base);
  const privateDockerService = url.protocol === 'http:' && url.hostname === 'ollama';
  if (!privateDockerService && url.protocol !== 'https:') {
    throw new Error('Model endpoint must be HTTPS or private Docker service ollama');
  }
  if (url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/v1/')) {
    throw new Error('Model URL must end with /v1/ and contain no credentials or query');
  }
  if (!privateDockerService && !token) {
    throw new Error('Remote HTTPS inference requires CODERAX_MODEL_INTERNAL_TOKEN');
  }
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const options = { headers, redirect: 'error', signal: AbortSignal.timeout(90000) };
  const listed = await fetch(new URL('models', url), options);
  if (!listed.ok) throw new Error('Model inventory request failed');
  const inventory = await listed.json();
  if (!Array.isArray(inventory.data) || !inventory.data.some((item) => item.id === model)) {
    throw new Error('Required remote model is missing');
  }
  const completion = await fetch(new URL('chat/completions', url), {
    ...options,
    method: 'POST',
    body: JSON.stringify({
      model,
      stream: false,
      temperature: 0,
      max_tokens: 48,
      messages: [{ role: 'user', content: 'Reply with exactly CLOUD_MODEL_OK' }],
    }),
  });
  if (!completion.ok) throw new Error('Remote chat completion request failed');
  const body = await completion.json();
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.includes('CLOUD_MODEL_OK')) {
    throw new Error('Remote model produced no verifiable response');
  }
  process.stdout.write('CLOUD_MODEL_OK (remote inference verified)\n');
}
main().catch((error) => {
  // Deliberately no stack trace or remote error text: may include private tokens.
  process.stderr.write(`CLOUD_MODEL_CHECK_FAILED: ${error.message}\n`);
  process.exitCode = 1;
});
