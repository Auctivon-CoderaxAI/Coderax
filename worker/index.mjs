/**
 * Cloudflare Worker entry for the `coderax` service.
 *
 * `npm run frontend` writes the React app to client/dist, and the assets runtime
 * serves it with single-page-application fallback. That fallback would answer
 * `/api/*` with index.html and a 200, so those paths are routed here first (see
 * `assets.run_worker_first` in wrangler.jsonc) and forwarded to the authorized
 * backend instead.
 *
 * Configuration lives on the Worker, never in this file:
 *   CODERAX_API_ORIGIN    HTTPS origin of the authorized backend (required)
 *   CODERAX_PROXY_SECRET  Shared secret for that origin, when it expects one
 *
 * Without a usable origin the API route fails closed with 503, matching
 * packages/api/src/proxy.ts rather than silently serving HTML.
 */

const API_PATHS = new Set(['/api', '/oauth', '/health', '/livez', '/readyz']);

const HOP_BY_HOP_HEADERS = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
];

export function isApiPath(pathname) {
  return API_PATHS.has(pathname) || pathname.startsWith('/api/') || pathname.startsWith('/oauth/');
}

export function parseApiOrigin(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  let origin;
  try {
    origin = new URL(value);
  } catch {
    return null;
  }
  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.port ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  ) {
    return null;
  }
  return origin;
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function connectionOptions(value) {
  return (value ?? '')
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0);
}

function forwardedHeaders(request, host) {
  const headers = new Headers();
  const nominated = new Set(connectionOptions(request.headers.get('connection')));
  for (const [name, value] of request.headers) {
    const lowerName = name.toLowerCase();
    if (
      HOP_BY_HOP_HEADERS.includes(lowerName) ||
      nominated.has(lowerName) ||
      lowerName.startsWith('x-forwarded-') ||
      lowerName.startsWith('x-vercel-') ||
      lowerName === 'x-real-ip' ||
      lowerName === 'x-coderax-proxy-secret'
    ) {
      continue;
    }
    headers.set(name, value);
  }
  headers.set('x-forwarded-host', host);
  headers.set('x-forwarded-proto', 'https');
  return headers;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!isApiPath(url.pathname)) {
      return env.ASSETS.fetch(request);
    }

    const upstream = parseApiOrigin(env.CODERAX_API_ORIGIN);
    if (!upstream) {
      return json(503, { error: 'API proxy is not configured' });
    }

    const headers = forwardedHeaders(request, url.host);
    const secret = env.CODERAX_PROXY_SECRET;
    if (typeof secret === 'string' && secret.length >= 32) {
      headers.set('x-coderax-proxy-secret', secret);
    }

    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
    let response;
    try {
      response = await fetch(`${upstream.origin}${url.pathname}${url.search}`, {
        method: request.method,
        headers,
        body: hasBody ? request.body : undefined,
        redirect: 'manual',
      });
    } catch {
      return json(502, { error: 'API origin is unavailable' });
    }

    const responseHeaders = new Headers(response.headers);
    for (const name of connectionOptions(responseHeaders.get('connection'))) {
      responseHeaders.delete(name);
    }
    for (const name of HOP_BY_HOP_HEADERS) {
      responseHeaders.delete(name);
    }
    responseHeaders.delete('x-coderax-proxy-secret');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  },
};
