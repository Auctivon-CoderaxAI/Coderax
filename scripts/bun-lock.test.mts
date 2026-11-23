import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { canonicalOverrides, overridesProblems, parseBunLock } from './bun-lock.mts';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const readJson = (file: string): { overrides?: unknown } =>
  JSON.parse(readFileSync(join(root, file), 'utf8')) as { overrides?: unknown };

const manifest = readJson('package.json');
const lock = parseBunLock(readFileSync(join(root, 'bun.lock'), 'utf8'));
const declared = manifest.overrides as Record<string, unknown>;
const recorded = lock.overrides as Record<string, unknown>;

test('the committed bun.lock records the overrides package.json declares', () => {
  assert.deepEqual(overridesProblems(manifest.overrides, lock.overrides), []);
});

test('an override added to package.json without regenerating the lockfile is caught', () => {
  const problems = overridesProblems({ ...declared, 'left-pad': '1.0.0' }, recorded);
  assert.match(
    problems.join('\n'),
    /package\.json declares the override left-pad = "1\.0\.0", which bun\.lock does not record/,
  );
});

test('an override changed in package.json is caught', () => {
  const problems = overridesProblems({ ...declared, hono: '^9.9.9' }, recorded);
  assert.match(
    problems.join('\n'),
    /package\.json declares the override hono = "\^9\.9\.9" but bun\.lock records "\^4\.13\.16"/,
  );
});

test('an override dropped from package.json but still in the lockfile is caught', () => {
  const withoutFflate = { ...declared };
  delete withoutFflate.fflate;
  const problems = overridesProblems(withoutFflate, recorded);
  assert.match(
    problems.join('\n'),
    /bun\.lock records the override fflate = "\^0\.8\.3", which package\.json no longer declares/,
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
  assert.deepEqual(canonicalOverrides(recorded), recorded);
});

test('trailing commas are read and a comma inside a string survives', () => {
  const parsed = parseBunLock(
    '{\n  "overrides": {\n    "a": "^1.0.0",\n  },\n  "note": "keep, this",\n  "packages": {},\n}',
  );
  assert.deepEqual(parsed, { overrides: { a: '^1.0.0' }, note: 'keep, this', packages: {} });
  assert.ok(Object.keys(recorded).length > 0);
});
