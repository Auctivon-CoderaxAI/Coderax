import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import test from 'node:test';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(resolve(projectRoot, 'client', 'vercel.json'), 'utf8'));
const clientPackage = JSON.parse(readFileSync(resolve(projectRoot, 'client', 'package.json'), 'utf8'));
const rewrite = config.rewrites.find(({ destination }) => destination === '/index.html');

test('Vercel client-workspace settings remain managed by the project', () => {
  assert.equal(config.buildCommand, undefined);
  assert.equal(config.outputDirectory, undefined);
});

test('Vercel can run the monorepo frontend build from the client workspace', () => {
  assert.equal(clientPackage.scripts.frontend, 'cd .. && npm run frontend');
});

test('client-side routes are rewritten to the application shell', () => {
  assert.ok(rewrite, 'An index.html fallback is required for a client-side SPA');
  const pattern = new RegExp(`^${rewrite.source}$`);
  for (const route of ['/', '/login', '/register', '/c/new', '/c/123', '/settings', '/404']) {
    assert.match(route, pattern, route);
  }
});

test('API, OAuth, metrics and static asset requests never get HTML fallbacks', () => {
  const pattern = new RegExp(`^${rewrite.source}$`);
  for (const route of [
    '/api', '/api/config', '/api/ask', '/oauth', '/oauth/google/callback',
    '/metrics', '/metrics/foo', '/assets/app.js', '/sw.js',
    '/manifest.webmanifest', '/.well-known/openid-configuration',
  ]) {
    assert.doesNotMatch(route, pattern, route);
  }
});
