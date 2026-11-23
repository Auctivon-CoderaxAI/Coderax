import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

for (const [signal, exitCode] of [
  ['SIGINT', 130],
  ['SIGTERM', 143],
]) {
  test(`${signal} releases the lifecycle lock and keeps the service record`, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coderax-stack-test-'));
    const scripts = path.join(root, 'scripts/dev');
    const lock = path.join(root, '.dev/stack.lock');
    const record = path.join(root, '.dev/pids/mongo.pid');
    let child;
    let exited;
    try {
      fs.mkdirSync(scripts, { recursive: true });
      for (const file of ['stack.mjs', 'pid-record.mjs', 'mongo-port.mjs', 'model-paths.mjs']) {
        fs.copyFileSync(new URL(file, import.meta.url), path.join(scripts, file));
      }
      fs.writeFileSync(path.join(scripts, 'mongo.mjs'), 'setInterval(() => {}, 1000);');
      const server = createServer().listen(0, '127.0.0.1');
      await once(server, 'listening');
      const { port } = server.address();
      await new Promise((resolve) => server.close(resolve));

      child = spawn(process.execPath, [path.join(scripts, 'stack.mjs'), 'up'], {
        env: { ...process.env, CODERAX_MONGO_PORT: String(port) },
        stdio: 'ignore',
      });
      exited = once(child, 'exit');
      for (let i = 0; i < 200 && !fs.existsSync(record) && child.exitCode == null; i++) {
        await delay(25);
      }
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
        try {
          process.kill(-pid, 'SIGKILL');
        } catch (error) {
          if (error.code !== 'ESRCH') {
            throw error;
          }
        }
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}
