import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

function bashBlocks(relativePath) {
  const source = fs
    .readFileSync(path.join(repoRoot, relativePath), 'utf8')
    .replace(/\r\n/g, '\n');
  const blocks = [];
  const fence = /```bash\n([\s\S]*?)```/g;
  let match;
  while ((match = fence.exec(source)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

function setupBlock(relativePath) {
  const block = bashBlocks(relativePath).find(
    (candidate) => candidate.includes('coderax login') && candidate.includes('coderax doctor'),
  );
  assert.ok(block, `${relativePath} must contain the CLI setup block`);
  return block;
}

function makeStubBin() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coderax-docs-'));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const log = path.join(root, 'commands.log');

  const write = (name, lines) => {
    const file = path.join(bin, name);
    fs.writeFileSync(file, lines.join('\n'), { mode: 0o755 });
    fs.chmodSync(file, 0o755);
  };

  write('npm', [
    '#!/usr/bin/env bash',
    'printf \'npm %s\\n\' "$*" >> "$CODERAX_STUB_LOG"',
    'exit 0',
    '',
  ]);

  write('coderax', [
    '#!/usr/bin/env bash',
    'set -eu',
    'printf \'coderax %s\\n\' "$*" >> "$CODERAX_STUB_LOG"',
    'case "$1" in',
    '  config) exit "${CODERAX_STUB_CONFIG_STATUS:-0}" ;;',
    '  login) cat >/dev/null; exit "${CODERAX_STUB_LOGIN_STATUS:-0}" ;;',
    '  doctor) exit "${CODERAX_STUB_DOCTOR_STATUS:-0}" ;;',
    'esac',
    'exit 0',
    '',
  ]);

  return { root, bin, log };
}

function runSetup(relativePath, { configStatus = 0, loginStatus = 0 } = {}) {
  const stub = makeStubBin();
  const result = spawnSync('bash', ['-c', setupBlock(relativePath)], {
    cwd: repoRoot,
    encoding: 'utf8',
    input: 'stub-token\n',
    env: {
      ...process.env,
      PATH: `${stub.bin}${path.delimiter}${process.env.PATH ?? ''}`,
      CODERAX_STUB_LOG: stub.log,
      CODERAX_STUB_CONFIG_STATUS: String(configStatus),
      CODERAX_STUB_LOGIN_STATUS: String(loginStatus),
      CODERAX_BASE_URL: 'https://must-be-unset.invalid',
      CODERAX_TOKEN: 'must-be-unset',
    },
  });
  const commands = fs.existsSync(stub.log) ? fs.readFileSync(stub.log, 'utf8') : '';
  fs.rmSync(stub.root, { recursive: true, force: true });
  return { result, commands };
}

test('README bash fences parse', () => {
  for (const relativePath of ['README.md', 'cli/README.md']) {
    const blocks = bashBlocks(relativePath);
    assert.ok(blocks.length > 0, `${relativePath} has at least one bash block`);
    blocks.forEach((block, index) => {
      const parsed = spawnSync('bash', ['-n'], { input: block, encoding: 'utf8' });
      assert.ifError(parsed.error);
      assert.equal(
        parsed.status,
        0,
        `${relativePath} bash block ${index + 1} failed to parse:\n${parsed.stderr}`,
      );
    });
  }
});

test('setup snippet stops before login when configuration fails', () => {
  const { result, commands } = runSetup('README.md', { configStatus: 1 });
  assert.ifError(result.error);
  assert.notEqual(result.status, 0);
  assert.match(commands, /coderax config set/);
  assert.doesNotMatch(commands, /coderax login/);
  assert.doesNotMatch(commands, /coderax doctor/);
});

test('setup snippet preserves login failure and skips doctor', () => {
  const { result, commands } = runSetup('README.md', { loginStatus: 3 });
  assert.ifError(result.error);
  assert.notEqual(result.status, 0);
  assert.match(commands, /coderax login/);
  assert.doesNotMatch(commands, /coderax doctor/);
});

test('setup snippet runs doctor only after successful login', () => {
  const { result, commands } = runSetup('README.md');
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(commands, /coderax login/);
  assert.match(commands, /coderax doctor/);
});

test('cli README setup snippet has the same failure behavior', () => {
  const failed = runSetup('cli/README.md', { configStatus: 1 });
  assert.ifError(failed.result.error);
  assert.notEqual(failed.result.status, 0);
  assert.doesNotMatch(failed.commands, /coderax doctor/);

  const passed = runSetup('cli/README.md');
  assert.ifError(passed.result.error);
  assert.equal(passed.result.status, 0, passed.result.stderr);
  assert.match(passed.commands, /coderax doctor/);
});
