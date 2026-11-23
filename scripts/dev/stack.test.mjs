import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { groupState, ownerKey } from './pid-record.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coderax-stack-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scripts = path.join(root, 'scripts/dev');
  const pids = path.join(root, '.dev/pids');
  fs.mkdirSync(scripts, { recursive: true });
  fs.mkdirSync(pids, { recursive: true });
  for (const file of [
    'stack.mjs',
    'launch.mjs',
    'pid-record.mjs',
    'mongo-port.mjs',
    'model-paths.mjs',
  ]) {
    fs.copyFileSync(new URL(file, import.meta.url), path.join(scripts, file));
  }
  return { root, scripts, pids, stack: path.join(scripts, 'stack.mjs') };
}

async function freePort() {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function killGroup(pid) {
  try {
    process.kill(-pid, 'SIGKILL');
  } catch (error) {
    if (error.code !== 'ESRCH') {
      throw error;
    }
  }
}

for (const [signal, exitCode] of [
  ['SIGINT', 130],
  ['SIGTERM', 143],
]) {
  test(`${signal} releases the lifecycle lock and keeps the service record`, async (t) => {
    const { root, scripts, pids, stack } = fixture(t);
    const lock = path.join(root, '.dev/stack.lock');
    const record = path.join(pids, 'mongo.pid');
    const marker = path.join(root, 'service-ran');
    let child;
    let exited;
    try {
      fs.writeFileSync(
        path.join(scripts, 'mongo.mjs'),
        `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'started'); setInterval(() => {}, 1000);`,
      );
      child = spawn(process.execPath, [stack, 'up'], {
        env: { ...process.env, CODERAX_MONGO_PORT: String(await freePort()) },
        stdio: 'ignore',
      });
      exited = once(child, 'exit');
      for (let i = 0; i < 200 && !fs.existsSync(marker) && child.exitCode == null; i++) {
        await delay(25);
      }
      assert.ok(fs.existsSync(marker), 'the recorded launcher did not start its service');
      assert.ok(fs.existsSync(record), 'service record was not created');
      assert.ok(fs.existsSync(lock));
      child.kill(signal);
      assert.deepEqual(await exited, [exitCode, null]);
      assert.ok(!fs.existsSync(lock));
      assert.ok(fs.existsSync(record));
    } finally {
      if (child && child.exitCode == null && child.signalCode == null) {
        child.kill('SIGKILL');
        await exited;
      }
      if (fs.existsSync(record)) {
        const { pid } = JSON.parse(fs.readFileSync(record, 'utf8'));
        killGroup(pid);
      }
    }
  });
}

test('SIGKILL before ownership publication prevents the service from launching', async (t) => {
  const { root, scripts, pids, stack } = fixture(t);
  const marker = path.join(root, 'service-ran');
  fs.writeFileSync(
    path.join(scripts, 'mongo.mjs'),
    `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'started');`,
  );
  const preload = path.join(root, 'interrupt.cjs');
  fs.writeFileSync(
    preload,
    "require('node:fs').renameSync = () => process.kill(process.pid, 'SIGKILL');",
  );
  const result = spawnSync(process.execPath, ['--require', preload, stack, 'up'], {
    env: { ...process.env, CODERAX_MONGO_PORT: String(await freePort()) },
    encoding: 'utf8',
    timeout: 5_000,
  });
  assert.equal(result.signal, 'SIGKILL', result.stderr);
  const [temporary] = fs.readdirSync(pids);
  assert.match(temporary, /^mongo[.]pid[.].+[.]tmp$/);
  const record = JSON.parse(fs.readFileSync(path.join(pids, temporary), 'utf8'));
  for (let i = 0; i < 200 && groupState(record) !== 'gone'; i++) {
    await delay(25);
  }
  assert.equal(groupState(record), 'gone');
  assert.ok(!fs.existsSync(marker), 'unrecorded service command ran');
});

const token = '01234567-1234-1234-1234-0123456789ab';

async function ownedGroup(t) {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, [ownerKey]: token },
  });
  const exited = once(child, 'exit');
  t.after(async () => {
    if (child.exitCode == null && child.signalCode == null) {
      child.kill('SIGKILL');
    }
    await exited;
  });
  await once(child, 'spawn');
  return { pid: child.pid, token };
}

test('up refuses to reuse a network preview in loopback mode', async (t) => {
  const { pids, stack } = fixture(t);
  const record = await ownedGroup(t);
  fs.writeFileSync(
    path.join(pids, 'ui.pid'),
    JSON.stringify({ ...record, previewHost: 'preview.test' }),
  );
  const result = spawnSync(process.execPath, [stack, 'up'], {
    env: { ...process.env, CODERAX_PREVIEW_HOST: '' },
    encoding: 'utf8',
    timeout: 5_000,
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /preview settings differ or are unknown; run npm run dev:down/);
  assert.equal(groupState(record), 'owned', 'the live group can still be stopped by dev:down');
});

test('down preserves invalid records and still stops later verified groups', async (t) => {
  const { pids, stack } = fixture(t);
  const record = await ownedGroup(t);
  const uiRecord = path.join(pids, 'ui.pid');
  const mongoRecord = path.join(pids, 'mongo.pid');
  fs.writeFileSync(uiRecord, '{bad json');
  fs.writeFileSync(mongoRecord, JSON.stringify(record));
  const result = spawnSync(process.execPath, [stack, 'down'], { encoding: 'utf8', timeout: 5_000 });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /ui: shutdown incomplete:.*invalid process record/);
  assert.match(result.stdout, /mongo: stopped/);
  assert.equal(fs.readFileSync(uiRecord, 'utf8'), '{bad json');
  assert.ok(!fs.existsSync(mongoRecord));
  assert.equal(groupState(record), 'gone');
});
