#!/usr/bin/env node
/**
 * One-shot private inference smoke test. It can run inside the API container
 * against a Compose-hosted Ollama, or against an authenticated HTTPS endpoint.
 * No provider key or cloud account is required for the Compose case.
 *
 * The probe reports the placement it can actually observe: `private-docker-service`
 * or `remote-https`. A request made from inside the deployment cannot prove the
 * deployment host is cloud-hosted, so this check never claims cloud inference.
 * Exits nonzero when the model is unavailable or does not answer correctly.
 * It never prints credentials, response text, or upstream error bodies.
 */
import { pathToFileURL } from 'node:url';

const PRIVATE_DOCKER_SERVICE = 'ollama';
const REPLY_MARKER = 'MODEL_PROBE_OK';

/**
 * Validate the configured endpoint and name its observed placement. A bare
 * service name is accepted only for the private Docker `ollama` service; every
 * other endpoint must be authenticated HTTPS.
 */
export function classifyModelTarget(base) {
  const url = new URL(base);
  const privateDockerService = url.protocol === 'http:' && url.hostname === PRIVATE_DOCKER_SERVICE;
  if (!privateDockerService && url.protocol !== 'https:') {
    throw new Error('Model endpoint must be HTTPS or private Docker service ollama');
  }
  if (url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/v1/')) {
    throw new Error('Model URL must end with /v1/ and contain no credentials or query');
  }
  return {
    url,
    placement: privateDockerService ? 'private-docker-service' : 'remote-https',
  };
}

/** The success report names placement without asserting where the host runs. */
export function formatProbeSuccess(placement) {
  const detail =
    placement === 'private-docker-service'
      ? 'private Docker service on the deployment network; cloud placement is not verified'
      : 'authenticated HTTPS endpoint; hosting provider is not verified';
  return `MODEL_PROBE_OK\nMODEL_PLACEMENT: ${placement} (${detail})\n`;
}

/**
 * Verify that the configured model is listed and answers with the probe marker.
 * Returns the observed placement so the caller can report it truthfully.
 */
export async function probeModel({
  base,
  model,
  token,
  fetchImpl = fetch,
  timeoutMs = 90_000,
} = {}) {
  const resolvedBase = base ?? process.env.CODERAX_MODEL_BASE_URL ?? 'http://ollama:11434/v1/';
  const resolvedModel = model ?? process.env.CODERAX_MODEL_ID ?? 'qwen3.5:4b';
  const resolvedToken = token ?? process.env.CODERAX_MODEL_INTERNAL_TOKEN;

  const { url, placement } = classifyModelTarget(resolvedBase);
  if (placement === 'remote-https' && !resolvedToken) {
    throw new Error('Remote HTTPS inference requires CODERAX_MODEL_INTERNAL_TOKEN');
  }
  const headers = {
    'Content-Type': 'application/json',
    ...(resolvedToken ? { Authorization: `Bearer ${resolvedToken}` } : {}),
  };
  const options = { headers, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) };

  const listed = await fetchImpl(new URL('models', url), options);
  if (!listed.ok) throw new Error('Model inventory request failed');
  const inventory = await listed.json();
  if (!Array.isArray(inventory.data) || !inventory.data.some((item) => item.id === resolvedModel)) {
    throw new Error('Required model is missing from the endpoint inventory');
  }

  const completion = await fetchImpl(new URL('chat/completions', url), {
    ...options,
    method: 'POST',
    body: JSON.stringify({
      model: resolvedModel,
      stream: false,
      temperature: 0,
      max_tokens: 48,
      messages: [{ role: 'user', content: `Reply with exactly ${REPLY_MARKER}` }],
    }),
  });
  if (!completion.ok) throw new Error('Model chat completion request failed');
  const body = await completion.json();
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.includes(REPLY_MARKER)) {
    throw new Error('Model produced no verifiable response');
  }
  return { placement, model: resolvedModel };
}

async function main() {
  const result = await probeModel();
  process.stdout.write(formatProbeSuccess(result.placement));
}

const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error) => {
    // Deliberately no stack trace or remote error text: may include private tokens.
    process.stderr.write(`MODEL_PROBE_FAILED: ${error.message}\n`);
    process.exitCode = 1;
  });
}
