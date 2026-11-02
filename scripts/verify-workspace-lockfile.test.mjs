import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const manifest = readJson(join(root, 'package.json'));
const lock = readJson(join(root, 'package-lock.json'));

function workspacePaths() {
  return manifest.workspaces.flatMap((pattern) => {
    if (!pattern.endsWith('/*')) return [pattern];
    const parent = pattern.slice(0, -2);
    return readdirSync(join(root, parent), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(root, parent, entry.name, 'package.json')))
      .map((entry) => `${parent}/${entry.name}`);
  });
}

function errorsFor(candidate) {
  const errors = [];
  for (const workspace of workspacePaths()) {
    const pkg = readJson(join(root, workspace, 'package.json'));
    const locked = candidate.packages?.[workspace];
    if (!locked) {
      errors.push(`missing workspace entry: ${workspace}`);
      continue;
    }
    if (locked.name !== pkg.name || locked.version !== pkg.version) {
      errors.push(`workspace identity/version mismatch: ${workspace}`);
    }
    const link = candidate.packages?.[`node_modules/${pkg.name}`];
    if (!link || link.link !== true || link.resolved !== workspace) {
      errors.push(`missing or incorrect workspace symlink: ${pkg.name}`);
    }
  }
  return errors;
}

test('npm lockfile covers every declared workspace and its symlink', () => {
  assert.deepEqual(errorsFor(lock), []);
});

test('missing workspace entry is detected', () => {
  const changed = structuredClone(lock);
  delete changed.packages['packages/product-registry'];
  assert.match(errorsFor(changed).join('\n'), /missing workspace entry: packages\/product-registry/);
});

test('missing workspace link is detected', () => {
  const changed = structuredClone(lock);
  delete changed.packages['node_modules/@coderax/security-lab-core'];
  assert.match(errorsFor(changed).join('\n'), /missing or incorrect workspace symlink: @coderax\/security-lab-core/);
});

test('workspace version drift is detected', () => {
  const changed = structuredClone(lock);
  changed.packages['packages/product-registry'].version = '0.0.0';
  assert.match(errorsFor(changed).join('\n'), /workspace identity\/version mismatch: packages\/product-registry/);
});
