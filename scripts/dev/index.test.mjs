import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

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
