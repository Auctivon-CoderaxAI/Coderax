#!/usr/bin/env node
import { rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const generatedEntry = fileURLToPath(new URL('../dist/index.cjs', import.meta.url));
const bundledEntry = fileURLToPath(new URL('../dist/index.bundle.cjs', import.meta.url));

await rename(generatedEntry, bundledEntry);
await writeFile(
  generatedEntry,
  [
    "const generated = require('./index.bundle.cjs');",
    'const dataSchemasExports = { ...generated };',
    "Object.defineProperty(dataSchemasExports, 'default', {",
    '  configurable: false,',
    '  enumerable: false,',
    '  value: dataSchemasExports,',
    '  writable: false,',
    '});',
    'module.exports = dataSchemasExports;',
    '',
  ].join('\n'),
);
