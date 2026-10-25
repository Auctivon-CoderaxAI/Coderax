import { isIP } from 'node:net';
import * as https from 'node:https';
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http';

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export function parseApiOrigin(value: string | undefined): URL {
  if (!value) {
    throw new Error('CODERAX_API_ORIGIN must be a valid HTTPS origin');
  }

  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    throw new Error('CODERAX_API_ORIGIN must be a valid HTTPS origin');
  }

  const match = origin.hostname.match(
    /^coderax-(\d{1,3})-(\d{1,3})-(\d{1,3})-(\d{1,3})\.sslip\.io$/i,
  );
  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.port ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    !match
  ) {
    throw new Error('CODERAX_API_ORIGIN must be the HTTPS sslip.io origin for the Coderax VM');
  }

  const octets = match.slice(1).map(Number);
  const [a, b, c] = octets;
  const isPrivateOrReserved =
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
  if (octets.some((octet) => octet > 255) || isPrivateOrReserved) {
    throw new Error('CODERAX_API_ORIGIN must resolve to a public IPv4 address');
  }

  return origin;
}

function allowedHosts(env: NodeJS.ProcessEnv): Set<string> {
  const values = [
    env.DOMAIN_CLIENT,
    env.DOMAIN_SERVER,
    env.VERCEL_URL,
    ...(env.CODERAX_ALLOWED_HOSTS ?? '').split(','),
  ];
  return new Set(
    values
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .flatMap((value) => {
        try {
          const url = new URL(value.includes('://') ? value : `https://${value.trim()}`);
          return url.protocol === 'https:' ? [url.host.toLowerCase()] : [];
        } catch {
          return [];
        }
      }),
  );
}

export function isApiPath(pathname: string): boolean {
  return (
    pathname === '/api' ||
    pathname.startsWith('/api/') ||
    pathname === '/oauth' ||
    pathname.startsWith('/oauth/') ||
    pathname === '/health' ||
    pathname === '/livez' ||
    pathname === '/readyz'
  );
}

function json(res: ServerResponse, status: number, body: Record<string, string>): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

type ProxyRequest = typeof https.request;

export function createProxyHandler({
  env = process.env,
  request = https.request,
}: {
  env?: NodeJS.ProcessEnv;
  request?: ProxyRequest;
} = {}): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    let upstream: URL;
    try {
      upstream = parseApiOrigin(env.CODERAX_API_ORIGIN);
    } catch {
      json(res, 503, { error: 'API proxy is not configured' });
      return;
    }

    const secret = env.CODERAX_PROXY_SECRET;
    if (typeof secret !== 'string' || secret.length < 32) {
      json(res, 503, { error: 'API proxy is not configured' });
      return;
    }

    let pathname: string;
    try {
      pathname = new URL(req.url || '/', 'https://coderax.invalid').pathname;
    } catch {
      json(res, 400, { error: 'Invalid request path' });
      return;
    }
    if (!isApiPath(pathname)) {
      json(res, 404, { error: 'Not found' });
      return;
    }

    const clientHost = String(req.headers.host || '').toLowerCase();
    if (!clientHost || !allowedHosts(env).has(clientHost)) {
      json(res, 421, { error: 'Unknown application host' });
      return;
    }

    const headers: OutgoingHttpHeaders = {};
    for (const [name, value] of Object.entries(req.headers)) {
      const lowerName = name.toLowerCase();
      if (
        value !== undefined &&
        !HOP_BY_HOP_HEADERS.has(lowerName) &&
        !lowerName.startsWith('x-forwarded-') &&
        !lowerName.startsWith('x-vercel-') &&
        lowerName !== 'x-real-ip' &&
        lowerName !== 'x-coderax-proxy-secret'
      ) {
        headers[lowerName] = value;
      }
    }
    headers.host = upstream.host;
    headers['x-coderax-proxy-secret'] = secret;
    headers['x-forwarded-host'] = clientHost;
    headers['x-forwarded-proto'] = 'https';
    const vercelClientIp = String(req.headers['x-vercel-forwarded-for'] || '').trim();
    if (isIP(vercelClientIp)) {
      headers['x-forwarded-for'] = vercelClientIp;
    }

    let proxyRequest: ReturnType<ProxyRequest>;
    let proxyResponse: IncomingMessage | undefined;
    try {
      proxyRequest = request(
        {
          protocol: upstream.protocol,
          hostname: upstream.hostname,
          port: upstream.port || 443,
          method: req.method,
          path: req.url || '/',
          headers,
        },
        (response) => {
          proxyResponse = response;
          response.on('error', () => fail(response));
          response.on('aborted', () => fail(response));
          response.on('close', () => {
            if (response.complete === false) fail(response);
          });
          res.statusCode = response.statusCode || 502;
          for (const [name, value] of Object.entries(response.headers || {})) {
            const lowerName = name.toLowerCase();
            if (
              value !== undefined &&
              !HOP_BY_HOP_HEADERS.has(lowerName) &&
              lowerName !== 'x-coderax-proxy-secret'
            ) {
              res.setHeader(name, value);
            }
          }
          response.pipe(res);
        },
      );
    } catch {
      json(res, 502, { error: 'API origin is unavailable' });
      return;
    }

    function fail(response?: IncomingMessage): void {
      if (res.writableEnded || res.destroyed) return;
      if (!res.headersSent) {
        for (const name of Object.keys(response?.headers || {})) {
          res.removeHeader(name);
        }
        json(res, 502, { error: 'API origin is unavailable' });
      } else {
        res.destroy();
      }
    }

    proxyRequest.on('error', () => fail(proxyResponse));
    req.on('aborted', () => proxyRequest.destroy());
    res.on('close', () => {
      if (!res.writableEnded) {
        proxyRequest.destroy();
        proxyResponse?.destroy();
      }
    });
    req.pipe(proxyRequest);
  };
}
