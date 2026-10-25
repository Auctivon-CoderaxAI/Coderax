#!/usr/bin/env node
/**
 * Integration regression: the compiled API must be importable without the
 * optional Redis provider when USE_REDIS is false. This executes the actual
 * emitted CommonJS bundle, not a source-text or mocked API response.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { test } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(root, 'packages/api/dist/index.cjs');

test('compiled API does not load Redis adapters when Redis is disabled', () => {
  const code = `
    process.env.USE_REDIS = 'false';
    delete process.env.REDIS_URI;
    require(process.argv[1]);
    const redisModules = Object.keys(require.cache).filter((filename) => {
      const path = filename.split(String.fromCharCode(92)).join('/');
      return path.includes('/node_modules/@keyv/redis/') || path.includes('/node_modules/rate-limit-redis/');
    });
    if (redisModules.length > 0) {
      throw new Error('OPTIONAL_REDIS_PROVIDER_LOADED');
    }
    process.stdout.write('OFFLINE_API_IMPORT_OK\\n');
    process.exit(0);
  `;
  const child = spawnSync(process.execPath, ['-e', code, entry], {
    cwd: root,
    encoding: 'utf8',
    // The emitted API is large; allow slower Windows CI runners to load it.
    timeout: 120_000,
    env: { ...process.env, USE_REDIS: 'false', REDIS_URI: '' },
  });
  assert.equal(child.error, undefined, String(child.error));
  assert.equal(child.status, 0, `API startup import failed: ${child.stderr || child.stdout}`);
  assert.match(child.stdout, /OFFLINE_API_IMPORT_OK/);
});
