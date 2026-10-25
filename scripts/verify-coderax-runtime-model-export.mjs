#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const entry = require.resolve('@coderax/data-schemas/models');
const { createModels } = require('@coderax/data-schemas/models');
const rootEntry = require.resolve('@coderax/data-schemas');
const dataSchemas = require('@coderax/data-schemas');

assert.equal(
  typeof createModels,
  'function',
  `@coderax/data-schemas/models must export createModels; resolved ${entry}`,
);
assert.equal(
  typeof dataSchemas.logger,
  'object',
  `@coderax/data-schemas must expose its logger through CommonJS; resolved ${rootEntry}`,
);
assert.equal(
  typeof dataSchemas.runAsSystem,
  'function',
  `@coderax/data-schemas must expose runAsSystem through CommonJS; resolved ${rootEntry}`,
);
assert.equal(
  dataSchemas.default,
  dataSchemas,
  `@coderax/data-schemas must provide a default CommonJS interop export; resolved ${rootEntry}`,
);

console.log(`Verified @coderax/data-schemas/models.createModels via ${entry}`);
console.log(`Verified @coderax/data-schemas CommonJS interop exports via ${rootEntry}`);
