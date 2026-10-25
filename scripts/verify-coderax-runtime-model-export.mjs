#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const entry = require.resolve('@coderax/data-schemas/models');
const { createModels } = require('@coderax/data-schemas/models');

assert.equal(
  typeof createModels,
  'function',
  `@coderax/data-schemas/models must export createModels; resolved ${entry}`,
);

console.log(`Verified @coderax/data-schemas/models.createModels via ${entry}`);
