#!/usr/bin/env node
/**
 * End-to-end local probe: Mongo, the model, the API, sign-in, the model catalog,
 * one chat completion and a hard load of the conversation it created. Reports the
 * layer that failed instead of leaving you to curl each hop.
 *
 *   npm run dev:probe
 *   npm run dev:probe -- --base http://127.0.0.1:3090    # through the Vite/preview proxy
 *   npm run dev:probe -- --client http://127.0.0.1:3090 # the shell origin for the route layer
 *
 * The guest layer mirrors what the browser does at /connect: it opens a guest
 * session, reads /api/user with that token and asks /api/models for the catalog.
 * The route layer requests a conversation deep link as a fresh page load, then
 * resolves the shell's entry script from that same path.
 */
import net from 'node:net';

import { mongoUri } from './services.mjs';
import { loadEnv } from './lib.mjs';

const env = loadEnv();
const args = process.argv.slice(2);
const baseFlag = args.indexOf('--base');
const base = (
  baseFlag !== -1
    ? args[baseFlag + 1]
    : env.DEV_PROBE_BASE || `http://127.0.0.1:${env.PORT || 3080}`
).replace(/\/+$/, '');
const clientFlag = args.indexOf('--client');
const clientBase = (
  clientFlag !== -1
    ? args[clientFlag + 1]
    : env.DEV_PROBE_CLIENT || `http://127.0.0.1:${env.DEV_VITE_PORT || 3090}`
).replace(/\/+$/, '');

const endpoint = env.DEV_ENDPOINT || 'llamacpp';
const email = env.DEV_USER_EMAIL || 'dev@coderax.local';
const password = env.DEV_USER_PASSWORD;
const modelBase = (
  env.LLAMA_BASE_URL || `http://127.0.0.1:${env.DEV_MODEL_PORT || 8080}/v1`
).replace(/\/+$/, '');
const chatTimeoutMs = Number(env.DEV_PROBE_CHAT_TIMEOUT_MS || 120_000);

/* The chat route refuses requests whose User-Agent is not a browser. */
const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

class LayerError extends Error {
  constructor(layer, message) {
    super(message);
    this.layer = layer;
  }
}

const results = [];

async function layer(name, run) {
  try {
    const detail = await run();
    results.push({ name, ok: true, detail });
    console.log(`✔ ${name.padEnd(8)} ${detail}`);
  } catch (error) {
    results.push({ name, ok: false, detail: error.message });
    console.error(`✘ ${name.padEnd(8)} ${error.message}`);
    console.error(`\nfailed layer: ${error.layer ?? name}`);
    console.error('logs: .dev/logs/mongo.log, .dev/logs/model.log, .dev/logs/api.log');
    process.exit(1);
  }
}

function mongoAddress(uri) {
  const url = new URL(uri);
  return { host: url.hostname || '127.0.0.1', port: Number(url.port || 27017) };
}

function connectTcp(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

function messageText(message) {
  const content = message?.content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : (part?.text ?? '')))
      .join('')
      .trim();
  }
  if (typeof content === 'string') {
    return content.trim();
  }
  return String(message?.text ?? '').trim();
}

function modelIds(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) =>
        typeof entry === 'string' ? entry : (entry?.id ?? entry?.name ?? entry?.value ?? null),
      )
      .filter((id) => typeof id === 'string' && id.length > 0);
  }
  if (value && typeof value === 'object') {
    const defaults = modelIds(value.default);
    return defaults.length > 0 ? defaults : Object.keys(value);
  }
  return [];
}

async function readSse(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let reply = '';
  let streamed = '';
  let finalEvent = null;

  const handleFrame = (frame) => {
    const lines = frame.split('\n');
    const eventName = lines
      .filter((line) => line.startsWith('event:'))
      .map((line) => line.slice(6).trim())
      .join('');
    const data = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('');
    if (data === '' || data === '[DONE]') {
      return;
    }
    let event;
    try {
      event = JSON.parse(data);
    } catch {
      return;
    }
    if (eventName === 'error') {
      throw new LayerError('chat', `API stream reported an error: ${event.message ?? data}`);
    }
    if (event.error) {
      const detail =
        typeof event.error === 'string'
          ? event.error
          : (event.error.message ?? JSON.stringify(event.error));
      throw new LayerError('chat', `API stream reported an error: ${detail}`);
    }
    if (typeof event.text === 'string' && !event.final) {
      streamed += event.text;
    }
    if (event.final === true) {
      finalEvent = event;
      reply = messageText(event.responseMessage) || streamed.trim();
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      handleFrame(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');
    }
  }
  if (buffer.trim() !== '') {
    handleFrame(buffer);
  }
  return { reply: reply || streamed.trim(), finalEvent };
}

async function main() {
  const mongo = mongoAddress(mongoUri(env));

  await layer('mongo', async () => {
    if (!(await connectTcp(mongo.host, mongo.port))) {
      throw new LayerError(
        'mongo',
        `cannot connect to ${mongo.host}:${mongo.port} (is Mongo running? \`npm run dev:status\`)`,
      );
    }
    return `${mongo.host}:${mongo.port} reachable`;
  });

  let configuredModel = env.DEV_MODEL_ID || 'qwen2.5-1.5b-instruct';
  await layer('model', async () => {
    const origin = new URL(modelBase).origin;
    let health;
    try {
      health = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(4000) });
    } catch {
      throw new LayerError('model', `llama-server is not answering at ${origin}`);
    }
    if (!health.ok) {
      throw new LayerError('model', `llama-server /health returned HTTP ${health.status}`);
    }
    const listed = await fetch(`${origin}/v1/models`, { signal: AbortSignal.timeout(4000) });
    if (!listed.ok) {
      throw new LayerError('model', `llama-server /v1/models returned HTTP ${listed.status}`);
    }
    const payload = await listed.json();
    const ids = modelIds(payload?.data ?? payload);
    if (ids.length > 0) {
      configuredModel = ids[0];
    }
    return `${configuredModel} ready at ${origin}`;
  });

  await layer('api', async () => {
    let health;
    try {
      health = await fetch(`${base}/health`, { signal: AbortSignal.timeout(4000) });
    } catch {
      throw new LayerError('api', `no HTTP answer at ${base} (is the API running?)`);
    }
    if (!health.ok) {
      throw new LayerError('api', `${base}/health returned HTTP ${health.status}`);
    }
    const ready = await fetch(`${base}/readyz`, { signal: AbortSignal.timeout(4000) });
    if (ready.status === 503) {
      throw new LayerError('api', `${base} is up but still initializing (/readyz 503)`);
    }
    if (!ready.ok) {
      throw new LayerError('api', `${base}/readyz returned HTTP ${ready.status}`);
    }
    return `${base} healthy and ready`;
  });

  let token;
  await layer('auth', async () => {
    if (!password) {
      throw new LayerError('auth', 'set DEV_USER_PASSWORD in .env before running the probe');
    }
    const response = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      // No Origin/Sec-Fetch-Site: this is a CLI, not a browser page. The same-origin
      // guard only rejects requests a browser labels as cross-site.
      headers: { 'content-type': 'application/json', 'user-agent': BROWSER_UA },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.text();
    if (!response.ok) {
      let hint = 'unexpected auth failure';
      if (response.status === 401) {
        hint = `wrong password for ${email} (DEV_USER_EMAIL / DEV_USER_PASSWORD)`;
      } else if (response.status === 403) {
        hint = 'email login is disabled (set ALLOW_EMAIL_LOGIN=true) or the account is blocked';
      }
      throw new LayerError('auth', `POST /api/auth/login -> HTTP ${response.status}: ${hint}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new LayerError('auth', 'login returned a non-JSON body');
    }
    token = parsed.token;
    if (!token) {
      throw new LayerError('auth', 'login succeeded but returned no token');
    }
    return `${email} signed in`;
  });

  await layer('guest', async () => {
    const response = await fetch(`${base}/api/auth/guest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': BROWSER_UA },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const hint =
        response.status === 404
          ? 'guest access is disabled (set ENABLE_GUEST_ACCESS=true); the client entry screen needs it'
          : 'the browser cannot open the workspace';
      throw new LayerError('guest', `POST /api/auth/guest -> HTTP ${response.status}: ${hint}`);
    }
    let session;
    try {
      session = await response.json();
    } catch {
      throw new LayerError('guest', 'guest session returned a non-JSON body');
    }
    if (!session?.token) {
      throw new LayerError('guest', 'guest session returned no token');
    }
    const guestHeaders = {
      authorization: `Bearer ${session.token}`,
      'user-agent': BROWSER_UA,
    };
    const me = await fetch(`${base}/api/user`, {
      headers: guestHeaders,
      signal: AbortSignal.timeout(15_000),
    });
    if (!me.ok) {
      throw new LayerError('guest', `GET /api/user with the guest token -> HTTP ${me.status}`);
    }
    const user = await me.json();
    if (user?.provider !== 'guest') {
      throw new LayerError(
        'guest',
        `guest session resolved as provider "${user?.provider ?? 'unknown'}"`,
      );
    }
    const catalog = await fetch(`${base}/api/models`, {
      headers: guestHeaders,
      signal: AbortSignal.timeout(15_000),
    });
    if (!catalog.ok) {
      throw new LayerError('guest', `GET /api/models as a guest -> HTTP ${catalog.status}`);
    }
    const ids = modelIds((await catalog.json())?.[endpoint]);
    if (ids.length === 0) {
      throw new LayerError('guest', `guest sees no models for endpoint "${endpoint}"`);
    }
    return `${user.username ?? 'guest'} session, ${endpoint} -> ${ids.join(', ')}`;
  });

  const headers = { authorization: `Bearer ${token}` };
  await layer('models', async () => {
    const response = await fetch(`${base}/api/models`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new LayerError('models', `GET /api/models returned HTTP ${response.status}`);
    }
    const payload = await response.json();
    const ids = modelIds(payload?.[endpoint]);
    if (ids.length === 0) {
      throw new LayerError(
        'models',
        `no models listed for endpoint "${endpoint}"; check coderax.yaml endpoints.custom`,
      );
    }
    if (!ids.includes(configuredModel)) {
      console.warn(
        `! ${endpoint} lists ${ids.join(', ')} but llama-server reports ${configuredModel}`,
      );
    }
    return `${endpoint} -> ${ids.join(', ')}`;
  });

  let conversationId;
  await layer('chat', async () => {
    const controller = new AbortController();
    let timer;
    let phase = 'start';
    /** 30s buys the response headers; the body gets DEV_PROBE_CHAT_TIMEOUT_MS. */
    const arm = (ms, next) => {
      clearTimeout(timer);
      phase = next;
      timer = setTimeout(
        () => controller.abort(new DOMException(`${next} timeout`, 'TimeoutError')),
        ms,
      );
      timer.unref?.();
    };

    let result;
    try {
      arm(30_000, 'start');
      const start = await fetch(`${base}/api/agents/chat`, {
        method: 'POST',
        headers: {
          ...headers,
          'content-type': 'application/json',
          accept: 'text/event-stream',
          'user-agent': BROWSER_UA,
        },
        body: JSON.stringify({
          text: 'Reply with exactly one word: pong',
          endpoint,
          model: configuredModel,
          conversationId: null,
          parentMessageId: '00000000-0000-0000-0000-000000000000',
        }),
        signal: controller.signal,
      });
      if (!start.ok) {
        const body = (await start.text()).slice(0, 300);
        throw new LayerError('chat', `POST /api/agents/chat -> HTTP ${start.status}: ${body}`);
      }

      if ((start.headers.get('content-type') ?? '').includes('text/event-stream')) {
        // The stream itself can run for the model's whole turn, not 30 seconds.
        arm(chatTimeoutMs, 'stream');
        result = await readSse(start);
      } else {
        // The resumable protocol acks the turn with a job id; events stream separately.
        arm(30_000, 'start');
        const started = await start.json();
        const streamId = started.streamId ?? started.conversationId;
        if (!streamId) {
          throw new LayerError('chat', 'chat start returned no streamId');
        }
        arm(chatTimeoutMs, 'stream');
        const stream = await fetch(
          `${base}/api/agents/chat/stream/${encodeURIComponent(streamId)}`,
          {
            headers: { ...headers, accept: 'text/event-stream', 'user-agent': BROWSER_UA },
            signal: controller.signal,
          },
        );
        if (!stream.ok) {
          throw new LayerError('chat', `GET chat stream -> HTTP ${stream.status}`);
        }
        result = await readSse(stream);
      }
    } catch (error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') {
        throw new LayerError(
          'chat',
          phase === 'start'
            ? 'no answer from /api/agents/chat within 30s'
            : `no final event within ${chatTimeoutMs / 1000}s`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
    if (!result.finalEvent) {
      throw new LayerError('chat', 'stream ended without a final event');
    }
    if (result.finalEvent.responseMessage?.error === true || result.finalEvent.error) {
      throw new LayerError('chat', 'the agent finished the turn with an error');
    }
    if (!result.reply) {
      throw new LayerError('chat', 'the assistant returned an empty response');
    }
    conversationId =
      result.finalEvent.conversation?.conversationId ??
      result.finalEvent.responseMessage?.conversationId ??
      conversationId;
    return `model answered: "${result.reply.slice(0, 80)}"`;
  });

  await layer('route', async () => {
    if (!conversationId) {
      throw new LayerError('route', 'the chat layer did not report a conversation id');
    }
    const url = `${clientBase}/c/${encodeURIComponent(conversationId)}`;
    const response = await fetch(url, {
      headers: { accept: 'text/html', 'user-agent': BROWSER_UA },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new LayerError(
        'route',
        `hard load ${url} -> HTTP ${response.status} (is the client running at ${clientBase}?)`,
      );
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html')) {
      throw new LayerError('route', `hard load ${url} served ${contentType || 'no content type'}`);
    }
    const html = await response.text();
    if (!html.includes('<div id="root"')) {
      throw new LayerError('route', `hard load ${url} did not serve the client shell`);
    }
    /* Resolve the entry script the way the browser does: through the shell's
       <base href>, not the conversation path. Without one, a relative entry asks
       for /c/assets/... and the HTML fallback below is not JavaScript. */
    const entry =
      html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/i)?.[1] ??
      html.match(/<script[^>]+src="([^"]+\.js)"/i)?.[1];
    if (!entry) {
      throw new LayerError('route', 'the shell has no module entry script to resolve');
    }
    const baseHref = html.match(/<base[^>]+href="([^"]*)"/i)?.[1] ?? '';
    const entryUrl = new URL(entry, new URL(baseHref, url));
    const asset = await fetch(entryUrl, {
      headers: { 'user-agent': BROWSER_UA },
      signal: AbortSignal.timeout(15_000),
    });
    if (!asset.ok) {
      throw new LayerError(
        'route',
        `the shell's entry asset resolved to ${entryUrl.pathname} -> HTTP ${asset.status}`,
      );
    }
    const assetType = asset.headers.get('content-type') ?? '';
    if (!/javascript|ecmascript/i.test(assetType)) {
      throw new LayerError(
        'route',
        `the shell resolved its entry script to ${entryUrl.pathname}, which served ` +
          `${assetType || 'no content type'} instead of JavaScript`,
      );
    }
    return `hard load /c/<id> served the shell; ${entryUrl.pathname} -> ${asset.status} ${assetType}`;
  });

  console.log('\n✔ all layers healthy');
}

main().catch((error) => {
  console.error(`✘ ${error.layer ?? 'probe'} ${error.message}`);
  process.exit(1);
});
