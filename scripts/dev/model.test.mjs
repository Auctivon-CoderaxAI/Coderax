import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test(
  'rejects and removes an archive with the wrong digest before extraction',
  {
    skip: process.platform !== 'linux' || process.arch !== 'x64',
  },
  (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coderax-model-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const scripts = path.join(root, 'scripts/dev');
    fs.mkdirSync(scripts, { recursive: true });
    for (const file of ['model.mjs', 'model-paths.mjs']) {
      fs.copyFileSync(new URL(file, import.meta.url), path.join(scripts, file));
    }
    const preload = path.join(root, 'download.mjs');
    fs.writeFileSync(preload, "globalThis.fetch = async () => new Response('unexpected archive');");
    const result = spawnSync(
      process.execPath,
      ['--import', preload, path.join(scripts, 'model.mjs'), '--install'],
      { cwd: root, encoding: 'utf8', timeout: 5_000 },
    );

    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /llama\.cpp archive checksum mismatch/);
    assert.deepEqual(fs.readdirSync(path.join(root, '.dev/model')), []);
  },
);
