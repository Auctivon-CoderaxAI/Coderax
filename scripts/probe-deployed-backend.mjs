/**
 * Public production preflight for Coderax's Express backend.
 * SPA-only Vite deployments fail even when fallback returns HTTP 200.
 * This is NOT evidence of authenticated chat, real model inference, or worker durability.
 */
import { pathToFileURL } from 'node:url';

export async function probeDeployedBackend(baseURL, { request = fetch, timeoutMs = 8000 } = {}) {
  if (typeof baseURL !== 'string' || !baseURL.trim()) {
    throw new Error('CODERAX_BASE_URL must be an absolute http(s) URL');
  }
  const base = new URL(baseURL);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) {
    throw new Error('CODERAX_BASE_URL must be http(s) without embedded credentials');
  }
  if (base.search || base.hash || base.pathname !== '/') {
    throw new Error('CODERAX_BASE_URL must be the origin URL with no path, query, or fragment');
  }

  const checks = [
    { path: '/health', type: 'plain' },
    { path: '/readyz', type: 'plain' },
    { path: '/api/config', type: 'json' },
  ];
  const results = [];
  for (const check of checks) {
    const url = new URL(check.path, base);
    let response;
    try {
      response = await request(url, {
        method: 'GET',
        redirect: 'manual',
        cache: 'no-store',
        headers: { Accept: check.type === 'json' ? 'application/json' : 'text/plain' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      results.push({ path: check.path, ok: false, reason: 'NETWORK_OR_TIMEOUT' });
      continue;
    }
    if (response.status !== 200) {
      results.push({ path: check.path, ok: false, reason: 'HTTP_' + response.status });
      continue;
    }
    const body = await response.text();
    if (check.type === 'plain') {
      const ok = body.trim() === 'OK';
      results.push({ path: check.path, ok, reason: ok ? 'OK' : 'NOT_BACKEND_HEALTH' });
    } else {
      let valid = false;
      try {
        const value = JSON.parse(body);
        valid = value !== null && typeof value === 'object' && !Array.isArray(value) &&
          typeof value.appTitle === 'string' && value.appTitle.length > 0;
      } catch { /* SPA HTML is not a config response. */ }
      valid &&= (response.headers.get('content-type') ?? '').toLowerCase().includes('application/json');
      results.push({ path: check.path, ok: valid, reason: valid ? 'OK' : 'NOT_BACKEND_JSON' });
    }
  }
  return { ok: results.every((result) => result.ok), results };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await probeDeployedBackend(process.env.CODERAX_BASE_URL);
    for (const check of result.results) {
      console.log((check.ok ? 'PASS' : 'FAIL') + ' ' + check.path + ' ' + check.reason);
    }
    if (!result.ok) {
      console.error('Coderax backend preflight FAILED. Vite READY is not proof of an operational backend.');
      process.exitCode = 1;
    } else {
      console.log('Coderax backend preflight PASSED (authenticated chat/workers not tested).');
    }
  } catch (error) {
    console.error('Coderax backend preflight ERROR: ' + error.message);
    process.exitCode = 1;
  }
}
