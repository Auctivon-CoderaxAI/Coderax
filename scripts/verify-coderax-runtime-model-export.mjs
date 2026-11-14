#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const entry = require.resolve('@coderax/data-schemas/models');
const rootEntry = require.resolve('@coderax/data-schemas');
const apiEntry = require.resolve('@coderax/api');
const providerEntry = require.resolve('coderax-data-provider');

const consumerCheck = String.raw`
const modules = [
  { id: '@coderax/data-schemas/models', named: { createModels: 'function' } },
  { id: '@coderax/data-schemas', named: { logger: 'object', runAsSystem: 'function' } },
  { id: '@coderax/api', named: { isEnabled: 'function' } },
  { id: 'coderax-data-provider', named: { ViolationTypes: 'object' } },
];

for (const { id, named } of modules) {
  const value = require(id);
  for (const [name, type] of Object.entries(named)) {
    if (typeof value[name] !== type) {
      console.error(id + '.' + name + ' must be a ' + type + '; got ' + typeof value[name]);
      process.exit(1);
    }
  }
  if (id !== '@coderax/data-schemas/models' && value.default !== value) {
    console.error(id + ' is missing the CommonJS default interop export');
    process.exit(1);
  }
}

process.exit(0);
`;
const result = spawnSync(process.execPath, ['-e', consumerCheck], {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: { ...process.env, VERCEL: '1' },
  timeout: 60_000,
});

assert.equal(
  result.status,
  0,
  `Runtime workspace CommonJS exports failed: ${result.error?.message || result.stderr || result.stdout}`,
);

console.log(`Verified @coderax/data-schemas/models.createModels via ${entry}`);
console.log(`Verified @coderax/data-schemas CommonJS interop exports via ${rootEntry}`);
console.log(`Verified @coderax/api CommonJS interop exports via ${apiEntry}`);
console.log(`Verified coderax-data-provider CommonJS interop exports via ${providerEntry}`);
