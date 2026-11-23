import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  bunLockProblems,
  canonicalOverrides,
  overridesProblems,
  parseBunLock,
} from './bun-lock.mts';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
test('the committed bun.lock records the overrides package.json declares', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<
    string,
    unknown
  >;
  const lock = parseBunLock(readFileSync(join(root, 'bun.lock'), 'utf8'));
  assert.deepEqual(bunLockProblems(manifest, lock, root), []);
});

test('an override added to package.json without regenerating the lockfile is caught', () => {
  assert.deepEqual(overridesProblems({ 'left-pad': '1.0.0' }, {}), [
    'package.json declares the override left-pad = "1.0.0", which bun.lock does not record',
  ]);
});

test('an override changed in package.json is caught with fixed fixture values', () => {
  assert.deepEqual(overridesProblems({ hono: '^2.0.0' }, { hono: '^1.0.0' }), [
    'package.json declares the override hono = "^2.0.0" but bun.lock records "^1.0.0"',
  ]);
});

test('an override dropped from package.json but still in the lockfile is caught with a fixed fixture', () => {
  assert.deepEqual(overridesProblems({}, { fflate: '^1.0.0' }), [
    'bun.lock records the override fflate = "^1.0.0", which package.json no longer declares',
  ]);
});

test('root references compare against the declared range, including nested overrides', () => {
  const manifest = {
    dependencies: { lodash: '^4.17.23' },
    devDependencies: { '@scope/tool': '^2.1.0' },
    overrides: {
      lodash: '$lodash',
      '@scope/tool@2': '$@scope/tool',
      parent: { '.': '1.0.0', child: '$lodash' },
      unresolved: '$not-declared',
    },
  };
  const lock = {
    overrides: {
      lodash: '^4.17.23',
      '@scope/tool@2': { '.': '^2.1.0' },
      parent: { '.': '1.0.0', child: '^4.17.23' },
    },
  };
  assert.deepEqual(bunLockProblems(manifest, lock, root), []);
  lock.overrides.lodash = '^4.17.22';
  assert.deepEqual(bunLockProblems(manifest, lock, root), [
    'package.json declares the override lodash = "^4.17.23" but bun.lock records "^4.17.22"',
  ]);
});

test('workspace fallback reads current declarations, requires agreement and gives root priority', (t) => {
  const fixture = mkdtempSync(join(tmpdir(), 'bun-lock-test-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const writeWorkspace = (name: string, range: string) => {
    const dir = join(fixture, 'packages', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name, dependencies: { tool: range } }),
    );
  };
  writeWorkspace('one', '^1.0.0');
  writeWorkspace('two', '^1.0.0');
  const unnamedDir = join(fixture, 'packages', 'unnamed');
  mkdirSync(unnamedDir, { recursive: true });
  writeFileSync(
    join(unnamedDir, 'package.json'),
    JSON.stringify({ dependencies: { tool: '^2.0.0' } }),
  );
  const manifest = { workspaces: ['packages/*'], overrides: { tool: '$tool' } };
  const lock = { overrides: { tool: '^1.0.0' } };
  assert.deepEqual(bunLockProblems(manifest, lock, fixture), []);
  writeWorkspace('two', '^2.0.0');
  assert.deepEqual(bunLockProblems(manifest, {}, fixture), []);
  assert.deepEqual(bunLockProblems(manifest, lock, fixture), [
    'bun.lock records the override tool = "^1.0.0", which package.json no longer declares',
  ]);
  assert.deepEqual(
    bunLockProblems({ ...manifest, peerDependencies: { tool: '^1.0.0' } }, lock, fixture),
    [],
  );
});

test('a changed nested override is caught by its path', () => {
  assert.deepEqual(overridesProblems({ eslint: { ajv: '7.0.0' } }, { eslint: { ajv: '6.14.0' } }), [
    'package.json declares the override eslint → ajv = "7.0.0" but bun.lock records "6.14.0"',
  ]);
});

test('a version-qualified string override matches the lockfile’s "." spelling', () => {
  assert.deepEqual(
    overridesProblems(
      { 'postcss-selector-parser@6': '^6.1.3' },
      { 'postcss-selector-parser@6': { '.': '^6.1.3' } },
    ),
    [],
  );
});

test('a scoped package name is not mistaken for a version-qualified key', () => {
  assert.deepEqual(canonicalOverrides({ '@hono/node-server': '^2.1.6' }), {
    '@hono/node-server': '^2.1.6',
  });
});

test('an override nested twice is dropped, as bun drops it', () => {
  assert.deepEqual(
    overridesProblems(
      {
        katex: '^0.16.21',
        'remark-math': { 'micromark-extension-math': { katex: '^0.16.21' } },
        remark: { keep: '1.0.0', drop: { deeper: '2.0.0' } },
      },
      { katex: '^0.16.21', remark: { keep: '1.0.0' } },
    ),
    [],
  );
});

test('the lockfile side canonicalizes to itself', () => {
  const recorded = { 'pkg@2': { '.': '2.0.1' }, parent: { child: '3.0.0' } };
  assert.deepEqual(canonicalOverrides(recorded), recorded);
});

test('trailing commas are read and a comma inside a string survives', () => {
  const parsed = parseBunLock(
    '{\n  "overrides": {\n    "a": "^1.0.0",\n  },\n  "note": "keep, this",\n  "packages": {},\n}',
  );
  assert.deepEqual(parsed, { overrides: { a: '^1.0.0' }, note: 'keep, this', packages: {} });
});

