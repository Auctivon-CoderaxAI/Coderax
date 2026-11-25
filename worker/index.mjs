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
 *   CODERAX_API_ORIGIN     HTTPS sslip.io origin of the authorized backend (required)
 *   CODERAX_PROXY_SECRET   Shared secret Caddy requires (required, 32+ characters)
 *   CODERAX_ALLOWED_HOSTS  Optional comma-separated API host allowlist
 *
 * Without a usable origin the API route fails closed with 503, matching
 * packages/api/src/proxy.ts rather than silently serving HTML.
 */

const API_PATHS = new Set(['/api', '/oauth', '/health', '/livez', '/readyz']);

/** The authorized backend form: the Coderax VM's public IPv4 encoded by sslip.io. */
const BACKEND_HOSTNAME = /^coderax-(\d{1,3})-(\d{1,3})-(\d{1,3})-(\d{1,3})\.sslip\.io$/i;

/** The only host this Worker forwards API traffic for unless configured otherwise. */
export const DEFAULT_ALLOWED_HOST = 'coderax.nnabdelshahid.workers.dev';

export function parseAllowedHosts(value) {
  return (value ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0);
}

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

  const match = origin.hostname.match(BACKEND_HOSTNAME);
  if (!match) {
    return null;
  }
  const octets = match.slice(1).map(Number);
  const [a, b, c] = octets;
  const privateOrReserved =
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224;
  if (octets.some((octet) => octet > 255) || privateOrReserved) {
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
  // Preserve Cloudflare's verified client address so the API's per-IP login
  // and registration limiters meter visitors rather than the Caddy hop.
  const clientIp = request.headers.get('cf-connecting-ip');
  if (clientIp) {
    headers.delete('x-forwarded-for');
    headers.set('x-forwarded-for', clientIp);
  }
  return headers;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!isApiPath(url.pathname)) {
      return env.ASSETS.fetch(request);
    }

    // Mirror the Vercel proxy's host gate: a Worker reached through a hostname
    // it does not own must not be able to spend the backend proxy secret.
    const configuredHosts = parseAllowedHosts(env.CODERAX_ALLOWED_HOSTS);
    const allowedHosts = configuredHosts.length > 0 ? configuredHosts : [DEFAULT_ALLOWED_HOST];
    const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);
    if (
      !loopback.has(url.hostname.toLowerCase()) &&
      !allowedHosts.includes(url.host.toLowerCase())
    ) {
      return json(421, { error: 'Unknown application host' });
    }

    const upstream = parseApiOrigin(env.CODERAX_API_ORIGIN);
    if (!upstream) {
      return json(503, { error: 'API proxy is not configured' });
    }

    const secret = env.CODERAX_PROXY_SECRET;
    if (typeof secret !== 'string' || secret.length < 32) {
      return json(503, { error: 'API proxy is not configured' });
    }

    const headers = forwardedHeaders(request, url.host);
    headers.set('x-coderax-proxy-secret', secret);

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
