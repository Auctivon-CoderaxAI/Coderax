import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { appendMissingConfig, loadConfig, mergeLocalConfig, needsLocalConfig } from './config.mjs';
import { bootId } from './lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEV = path.join(ROOT, '.dev');
const RUN = path.join(DEV, 'run');
const LOCK = path.join(DEV, 'lifecycle.lock');
const CLI = path.join(ROOT, 'scripts', 'dev', 'index.mjs');

/* The supervisor owns `.dev`. Never stop a stack this test did not start. */
const records = existsSync(RUN) ? readdirSync(RUN).filter((name) => name.endsWith('.json')) : [];
const skip =
  records.length > 0 ? `a supervised stack is already recorded (${records.join(', ')})` : false;

function cli(args) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

test('dev:down refuses to run while the lifecycle lock is held', { skip }, () => {
  mkdirSync(LOCK, { recursive: true });
  try {
    const { status, output } = cli(['down']);
    assert.notEqual(status, 0, output);
    assert.match(output, /lifecycle\.lock/);
    assert.ok(existsSync(LOCK), 'a command that could not take the lock must not release it');
  } finally {
    rmSync(LOCK, { recursive: true, force: true });
  }
});

test('dev:down exits nonzero and keeps a live PID it cannot verify', { skip }, () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const record = {
    service: 'api',
    pid: child.pid,
    // A missing start time is what an older record, or a host without /proc, looks like.
    pidStart: null,
    bootId: bootId(),
    port: 65000,
    command: 'node',
    accessSettings: '',
    cwd: ROOT,
    startedAt: new Date().toISOString(),
    log: path.join(DEV, 'logs', 'api.log'),
  };
  mkdirSync(RUN, { recursive: true });
  writeFileSync(path.join(RUN, 'api.json'), `${JSON.stringify(record, null, 2)}\n`);

  try {
    const { status, output } = cli(['down']);
    assert.notEqual(status, 0, output);
    assert.match(output, /could not confirm shutdown/);
    assert.match(output, /keeping PID record/);
    assert.ok(existsSync(path.join(RUN, 'api.json')), 'the record must survive for a manual stop');
    assert.doesNotThrow(
      () => process.kill(child.pid, 0),
      'the unverified process must not be signalled',
    );
  } finally {
    rmSync(path.join(RUN, 'api.json'), { force: true });
    child.kill('SIGKILL');
  }
});

test('a clean dev:down releases the lock and exits 0', { skip }, () => {
  const { status, output } = cli(['down']);
  assert.equal(status, 0, output);
  assert.equal(existsSync(LOCK), false);
});

const configOptions = { modelPort: 8080, modelId: 'qwen2.5-1.5b-instruct' };

test('dev config adds llama.cpp and free inference without dropping existing settings', () => {
  const existing = {
    version: '1.3.17',
    freeInference: { enabled: false, maxRetries: 2 },
    engines: { defaultEngine: 'freebuff' },
    endpoints: { custom: [{ name: 'existing', baseURL: 'https://example.test/v1' }] },
  };

  const merged = mergeLocalConfig(existing, configOptions);

  assert.equal(merged.freeInference.enabled, true);
  assert.equal(merged.freeInference.maxRetries, 2);
  assert.deepEqual(merged.engines, existing.engines);
  assert.equal(merged.endpoints.custom.length, 2);
  assert.ok(merged.endpoints.custom.some((entry) => entry.name === 'existing'));
  assert.deepEqual(
    merged.endpoints.custom.find((entry) => entry.name === 'llamacpp'),
    {
      name: 'llamacpp',
      apiKey: 'local',
      baseURL: 'http://127.0.0.1:8080/v1',
      models: { default: ['qwen2.5-1.5b-instruct'], fetch: true },
      titleConvo: false,
      modelDisplayLabel: 'llama.cpp (local)',
    },
  );
});

test('an existing llama.cpp entry is updated in place and keeps extra fields', () => {
  const merged = mergeLocalConfig(
    {
      freeInference: { enabled: true },
      endpoints: {
        custom: [
          {
            name: 'llamacpp',
            baseURL: 'http://127.0.0.1:9999/v1',
            models: { default: ['stale-model'] },
            headers: { 'X-Dev': 'kept' },
          },
        ],
      },
    },
    configOptions,
  );

  assert.equal(merged.endpoints.custom.length, 1);
  assert.equal(merged.endpoints.custom[0].baseURL, 'http://127.0.0.1:8080/v1');
  assert.deepEqual(merged.endpoints.custom[0].models.default, ['qwen2.5-1.5b-instruct']);
  assert.deepEqual(merged.endpoints.custom[0].headers, { 'X-Dev': 'kept' });
});

test('appending missing sections preserves existing comments', () => {
  const text = [
    '# keep this comment',
    'version: 1.3.17',
    'freeInference:',
    '  enabled: true',
    '',
  ].join('\n');
  const appended = appendMissingConfig(text, loadConfig(text), configOptions);

  assert.ok(appended);
  assert.match(appended, /# keep this comment/);
  assert.equal(needsLocalConfig(loadConfig(appended), configOptions), false);
});

test('appending the free-inference opt-in leaves existing endpoints and comments intact', () => {
  const text = [
    '# keep this comment',
    'version: 1.3.17',
    'endpoints:',
    '  custom:',
    "    - name: 'llamacpp'",
    "      baseURL: 'http://127.0.0.1:8080/v1'",
    '      models:',
    '        default:',
    "          - 'qwen2.5-1.5b-instruct'",
    '',
  ].join('\n');
  const appended = appendMissingConfig(text, loadConfig(text), configOptions);

  assert.ok(appended);
  assert.match(appended, /# keep this comment/);
  assert.match(appended, /freeInference:\n {2}enabled: true/);
  assert.equal(needsLocalConfig(loadConfig(appended), configOptions), false);
});
