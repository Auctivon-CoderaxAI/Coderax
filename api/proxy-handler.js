'use strict';

const https = require('node:https');
const { isIP } = require('node:net');

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

function parseApiOrigin(value) {
  let origin;
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

function allowedHosts(env) {
  const values = [
    env.DOMAIN_CLIENT,
    env.DOMAIN_SERVER,
    env.VERCEL_URL,
    ...(env.CODERAX_ALLOWED_HOSTS ?? '').split(','),
  ];
  return new Set(
    values.filter(Boolean).flatMap((value) => {
      try {
        const url = new URL(value.includes('://') ? value : `https://${value.trim()}`);
        return url.protocol === 'https:' ? [url.host.toLowerCase()] : [];
      } catch {
        return [];
      }
    }),
  );
}

function isApiPath(pathname) {
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

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

function createProxyHandler({ env = process.env, request = https.request } = {}) {
  return (req, res) => {
    let upstream;
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

    let pathname;
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

    const headers = {};
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

    let proxyRequest;
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
        (proxyResponse) => {
          res.statusCode = proxyResponse.statusCode || 502;
          for (const [name, value] of Object.entries(proxyResponse.headers || {})) {
            const lowerName = name.toLowerCase();
            if (!HOP_BY_HOP_HEADERS.has(lowerName) && lowerName !== 'x-coderax-proxy-secret') {
              res.setHeader(name, value);
            }
          }
          proxyResponse.pipe(res);
        },
      );
    } catch {
      json(res, 502, { error: 'API origin is unavailable' });
      return;
    }

    proxyRequest.on('error', () => {
      if (!res.headersSent) {
        json(res, 502, { error: 'API origin is unavailable' });
      } else {
        res.destroy();
      }
    });
    req.on('aborted', () => proxyRequest.destroy());
    res.on('close', () => {
      if (!res.writableEnded) proxyRequest.destroy();
    });
    req.pipe(proxyRequest);
  };
}

module.exports = { createProxyHandler, isApiPath, parseApiOrigin };
