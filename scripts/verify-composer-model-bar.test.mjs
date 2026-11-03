import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const composerDir = 'client/src/components/Chat/Input/Composer';
const modelBar = readFileSync(resolve(root, composerDir, 'ModelBar.tsx'), 'utf8');
const tray = readFileSync(resolve(root, composerDir, 'Tray.tsx'), 'utf8');

function count(source, fragment) {
  return source.split(fragment).length - 1;
}

function validateModelBar(source) {
  assert.equal(count(source, '{conversation.model}</span>'), 1, 'active model must render exactly once');
  assert.equal(count(source, 'text-xs text-text-secondary'), 1, 'model bar must have one style definition');
}

function validateTray(source) {
  assert.equal(count(source, "import ModelBar from './ModelBar';"), 1, 'ModelBar import must be unique');
}

test('composer model bar renders one active model and one style definition', () => {
  validateModelBar(modelBar);
});

test('composer tray imports ModelBar exactly once', () => {
  validateTray(tray);
});

test('duplicate model label is rejected (negative regression)', () => {
  assert.throws(() => validateModelBar(modelBar.replace(
    '{conversation.model}</span>',
    '{conversation.model}</span>{conversation.model}</span>',
  )), /active model must render exactly once/);
});

test('duplicate import is rejected (negative regression)', () => {
  assert.throws(() => validateTray(tray + "\nimport ModelBar from './ModelBar';\n"), /ModelBar import must be unique/);
});
