import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';

for (const [signal, code] of [
  ['SIGINT', 130],
  ['SIGTERM', 143],
  ['SIGHUP', 129],
]) {
  test(
    `${signal} releases the stack lock and leaves the service stoppable`,
    {
      skip: process.platform !== 'linux',
      timeout: 10_000,
    },
    async (t) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coderax-stack-'));
      const scripts = path.join(root, 'scripts/dev');
      const entry = path.join(scripts, 'stack.mjs');
      const state = path.join(root, '.dev');
      fs.mkdirSync(scripts, { recursive: true });
      t.after(() => fs.rmSync(root, { recursive: true, force: true }));
      for (const file of ['stack.mjs', 'model-paths.mjs', 'mongo-port.mjs', 'pid-record.mjs']) {
        fs.copyFileSync(new URL(file, import.meta.url), path.join(scripts, file));
      }
      // The stand-in stays alive but never opens its port, so startup waits for readiness.
      fs.writeFileSync(path.join(scripts, 'mongo.mjs'), 'setInterval(() => {}, 1000);');
      const socket = net.createServer().listen(0, '127.0.0.1');
      await once(socket, 'listening');
      const { port } = socket.address();
      socket.close();
      await once(socket, 'close');
      const env = { ...process.env, CODERAX_MONGO_PORT: String(port) };
      const up = spawn(process.execPath, [entry, 'up'], { cwd: root, env });
      const closed = once(up, 'close');
      let stderr = '';
      up.stderr.setEncoding('utf8').on('data', (chunk) => {
        stderr += chunk;
      });
      const output = createInterface({ input: up.stdout });

      function down() {
        return spawnSync(process.execPath, [entry, 'down'], {
          cwd: root,
          env,
          encoding: 'utf8',
          timeout: 5_000,
        });
      }

      try {
        let started = false;
        for await (const line of output) {
          if (line.includes('starting mongo')) {
            started = true;
            break;
          }
        }
        assert.ok(started, stderr);
        assert.equal(fs.existsSync(path.join(state, 'stack.lock')), true);
        assert.ok(up.kill(signal));
        assert.deepEqual(await closed, [code, null], stderr);
        assert.equal(fs.existsSync(path.join(state, 'stack.lock')), false);
        const stopped = down();
        assert.ifError(stopped.error);
        assert.equal(stopped.status, 0, stopped.stderr);
        assert.match(stopped.stdout, /mongo: stopped/);
        assert.equal(fs.existsSync(path.join(state, 'pids/mongo.pid')), false);
      } finally {
        if (up.exitCode == null && up.signalCode == null) {
          up.kill('SIGTERM');
          await closed;
        }
        // Ensure the isolated stand-in is stopped even when a lock assertion fails.
        fs.rmSync(path.join(state, 'stack.lock'), { recursive: true, force: true });
        down();
      }
    },
  );
}
