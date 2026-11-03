import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = readFileSync(resolve(root, '.github/dependabot.yml'), 'utf8');

function parseUpdates(source) {
  return source
    .split(/(?=^  - package-ecosystem:)/m)
    .slice(1)
    .map((block) => ({
      ecosystem: block.match(/^  - package-ecosystem:\s*(\S+)$/m)?.[1],
      directory: block.match(/^    directory:\s*(\S+)$/m)?.[1],
      interval: block.match(/^      interval:\s*(\S+)$/m)?.[1],
      limit: Number(block.match(/^    open-pull-requests-limit:\s*(\d+)$/m)?.[1]),
    }));
}

function validateCoverage(source) {
  const entries = parseUpdates(source);
  const expected = [['npm', '/'], ['npm', '/desktop'], ['github-actions', '/']];
  assert.equal(entries.length, expected.length, 'unexpected Dependabot update entry count');
  for (const [ecosystem, directory] of expected) {
    const matches = entries.filter((entry) => (
      entry.ecosystem === ecosystem && entry.directory === directory
    ));
    assert.equal(matches.length, 1, `expected exactly one ${ecosystem} ${directory} entry`);
    assert.equal(matches[0].interval, 'weekly', 'updates must remain weekly');
    assert.equal(matches[0].limit, 2, 'open update PRs must remain capped at two');
  }
}

test('root, standalone desktop, and Actions have bounded weekly coverage', () => {
  validateCoverage(config);
});

test('missing standalone desktop npm coverage is rejected', () => {
  const withoutDesktop = config.replace(
    /  - package-ecosystem: npm\n    directory: \/desktop\n    schedule:\n      interval: weekly\n    open-pull-requests-limit: 2\n/,
    '',
  );
  assert.notEqual(withoutDesktop, config, 'negative fixture must remove desktop');
  assert.throws(() => validateCoverage(withoutDesktop), /unexpected Dependabot update entry count/);
});

test('increased update PR cap is rejected', () => {
  const unbounded = config.replace('open-pull-requests-limit: 2', 'open-pull-requests-limit: 3');
  assert.notEqual(unbounded, config, 'negative fixture must change limit');
  assert.throws(() => validateCoverage(unbounded), /capped at two/);
});

test('duplicate desktop npm coverage is rejected', () => {
  const desktop = config.match(/  - package-ecosystem: npm\n    directory: \/desktop\n    schedule:\n      interval: weekly\n    open-pull-requests-limit: 2\n/)?.[0];
  assert.ok(desktop, 'negative fixture requires a desktop block');
  assert.throws(() => validateCoverage(config + desktop), /unexpected Dependabot update entry count/);
});
