#!/usr/bin/env node
import { rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const entryPath = process.argv[2];

if (!entryPath || !/\.(?:cjs|js)$/.test(entryPath)) {
  throw new Error('Pass the generated CommonJS entry file path ending in .cjs or .js.');
}

const generatedEntry = resolve(process.cwd(), entryPath);
const bundledEntry = generatedEntry.replace(/\.(cjs|js)$/, '.bundle.$1');

await rename(generatedEntry, bundledEntry);
await writeFile(
  generatedEntry,
  [
    `const generated = require('./${bundledEntry.split(/[\\/]/).pop()}');`,
    'const runtimeExports = { ...generated };',
    "Object.defineProperty(runtimeExports, 'default', {",
    '  configurable: false,',
    '  enumerable: false,',
    '  value: runtimeExports,',
    '  writable: false,',
    '});',
    'module.exports = runtimeExports;',
    '',
  ].join('\n'),
);
