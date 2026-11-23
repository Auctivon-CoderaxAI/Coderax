/**
 * The gate behind "an overrides change has to ship with a regenerated
 * bun.lock". Bun records `overrides` inside bun.lock and compares them on
 * every install, so `bun install --frozen-lockfile` — which is how the
 * deployed build installs — aborts with "overrides in package.json changed
 * since bun.lock was saved" before it compiles anything.
 *
 * The two files are compared here rather than through a frozen install,
 * because the lanes that gate a pull request install with npm, where bun is
 * absent, and a frozen install also needs a registry. Reading both files
 * answers the same question offline and deterministically.
 *
 * Bun's rewrites decide what "agree" means, and both are exercised by
 * `bun-lock.test.mts`:
 *
 *   - a version-qualified key holding a string is recorded as `{ ".": value }`
 *     (`"postcss-selector-parser@6": "^6.1.3"` arrives as
 *     `"postcss-selector-parser@6": { ".": "^6.1.3" }`), because the version
 *     picks the copy and the string names its replacement;
 *   - a `$name` value uses a declared dependency range; unresolved references
 *     are omitted from the lockfile;
 *   - only one level of nested overrides is supported, so anything deeper is
 *     dropped from the lock — `remark-math → micromark-extension-math → katex`
 *     is absent from the lock and reported only as an install warning.
 */

import { join } from 'node:path';
import { globSync, readFileSync } from 'node:fs';

type Json = Record<string, unknown>;

const isPlainObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `name@range`, and `@scope/name@range` but not a scoped name on its own. */
const isVersionQualified = (key: string): boolean => key.lastIndexOf('@') > 0;

/**
 * bun.lock is JSON with trailing commas, which JSON.parse rejects. Commas are
 * dropped only where the next non-space character closes an object or array,
 * so a comma inside a string survives.
 */
export function parseBunLock(text: string): Json {
  let stripped = '';
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      stripped += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      stripped += char;
      continue;
    }
    if (char === ',') {
      let next = index + 1;
      while (next < text.length && /\s/.test(text[next])) next++;
      if (text[next] === '}' || text[next] === ']') continue;
    }
    stripped += char;
  }
  const parsed: unknown = JSON.parse(stripped);
  if (!isPlainObject(parsed)) throw new Error('bun.lock is not a JSON object');
  return parsed;
}

/**
 * package.json's overrides as bun records them, so the two sides can be
 * compared directly. Values bun cannot express are dropped rather than
 * reported: the lockfile never holds them, and `bun install` already warns
 * about the nesting on every run.
 */
export function canonicalOverrides(
  overrides: unknown,
  resolveValue: (value: string) => string | undefined = (value) => value,
): Json {
  if (!isPlainObject(overrides)) return {};
  const canonical: Json = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value === 'string') {
      const resolved = resolveValue(value);
      if (resolved !== undefined)
        canonical[key] = isVersionQualified(key) ? { '.': resolved } : resolved;
      continue;
    }
    if (!isPlainObject(value)) continue;
    const children: Json = {};
    for (const [child, nested] of Object.entries(value)) {
      if (typeof nested !== 'string') continue;
      const resolved = resolveValue(nested);
      if (resolved !== undefined) children[child] = resolved;
    }
    if (Object.keys(children).length > 0) canonical[key] = children;
  }
  return canonical;
}

const describe = (value: unknown): string => JSON.stringify(value) ?? String(value);

/** One level of nesting, which is all bun records, named by its parent key. */
function nestedProblems(parent: string, wanted: Json, recorded: Json): string[] {
  const problems: string[] = [];
  const children = [...new Set([...Object.keys(wanted), ...Object.keys(recorded)])].sort();
  for (const child of children) {
    const path = `${parent} → ${child}`;
    const expected = wanted[child];
    const actual = recorded[child];
    if (expected === undefined) {
      problems.push(
        `bun.lock records the override ${path} = ${describe(actual)}, which package.json no longer declares`,
      );
      continue;
    }
    if (actual === undefined) {
      problems.push(
        `package.json declares the override ${path} = ${describe(expected)}, which bun.lock does not record`,
      );
      continue;
    }
    if (expected !== actual) {
      problems.push(
        `package.json declares the override ${path} = ${describe(expected)} but bun.lock records ${describe(actual)}`,
      );
    }
  }
  return problems;
}

/**
 * Every way the overrides in package.json disagree with the ones recorded in
 * bun.lock, as messages a contributor can act on. Empty means the lockfile can
 * be installed with `--frozen-lockfile` without bun rejecting the overrides.
 */
export function overridesProblems(
  manifestOverrides: unknown,
  lockOverrides: unknown,
  resolveValue?: (value: string) => string | undefined,
): string[] {
  const wanted = canonicalOverrides(manifestOverrides, resolveValue);
  const recorded = canonicalOverrides(lockOverrides);
  const problems: string[] = [];
  const keys = [...new Set([...Object.keys(wanted), ...Object.keys(recorded)])].sort();
  for (const key of keys) {
    const expected = wanted[key];
    const actual = recorded[key];
    if (expected === undefined) {
      problems.push(
        `bun.lock records the override ${key} = ${describe(actual)}, which package.json no longer declares`,
      );
      continue;
    }
    if (actual === undefined) {
      problems.push(
        `package.json declares the override ${key} = ${describe(expected)}, which bun.lock does not record`,
      );
      continue;
    }
    if (isPlainObject(expected) && isPlainObject(actual)) {
      problems.push(...nestedProblems(key, expected, actual));
      continue;
    }
    if (describe(expected) !== describe(actual)) {
      problems.push(
        `package.json declares the override ${key} = ${describe(expected)} but bun.lock records ${describe(actual)}`,
      );
    }
  }
  return problems;
}

function declaredRange(manifest: Json, name: string, workspace = false): string | undefined {
  const ranges = [
    'optionalDependencies',
    'devDependencies',
    'dependencies',
    'peerDependencies',
  ].map((section) => {
    const entries = manifest[section];
    return isPlainObject(entries) &&
      Object.hasOwn(entries, name) &&
      typeof entries[name] === 'string'
      ? entries[name]
      : undefined;
  });
  const [optional, dev, prod, peer] = ranges;
  if (workspace) return prod ?? dev ?? optional ?? peer;
  // Bun retains the dev entry when a package is present in all four groups.
  return optional && dev && prod && peer ? dev : (optional ?? dev ?? prod ?? peer);
}

/** Compare the live manifest declarations, including Bun's workspace fallback. */
export function bunLockProblems(manifest: Json, lock: Json, root: string): string[] {
  let workspaces: Json[] | undefined;
  const resolveValue = (value: string): string | undefined => {
    if (!value.startsWith('$')) return value;
    const name = value.slice(1);
    const rootRange = declaredRange(manifest, name);
    if (rootRange !== undefined) return rootRange;
    if (workspaces === undefined) {
      const field = manifest.workspaces;
      const patterns = isPlainObject(field) ? field.packages : field;
      const paths = Array.isArray(patterns)
        ? patterns.filter((pattern): pattern is string => typeof pattern === 'string')
        : [];
      workspaces = globSync(
        paths.filter((path) => !path.startsWith('!')).map((path) => join(path, 'package.json')),
        {
          cwd: root,
          exclude: [
            '**/node_modules/**',
            ...paths
              .filter((path) => path.startsWith('!'))
              .map((path) => join(path.slice(1), 'package.json')),
          ],
        },
      )
        .map((path) => JSON.parse(readFileSync(join(root, path), 'utf8')) as Json)
        .filter((workspace) => typeof workspace.name === 'string' && workspace.name.trim() !== '');
    }
    let match: string | undefined;
    for (const workspace of workspaces) {
      const range = declaredRange(workspace, name, true);
      if (range === undefined) continue;
      if (match !== undefined && match !== range) return undefined;
      match = range;
    }
    return match;
  };
  return overridesProblems(manifest.overrides, lock.overrides, resolveValue);
}
