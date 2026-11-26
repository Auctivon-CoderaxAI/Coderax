import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import {
  ADVISORY_WORKFLOW_NAMES,
  evaluateGate,
  globToRegExp,
  indexRunsByWorkflow,
  loadWorkflows,
  matchesFilter,
  parseWorkflow,
  planGate,
} from './ci-gate.mjs';

const WORKFLOWS_DIRECTORY = fileURLToPath(new URL('../workflows/', import.meta.url));
const SELF_PATH = '.github/workflows/ci-gate.yml';

test('globToRegExp treats ** as any depth and * as one segment', () => {
  assert.equal(globToRegExp('**.md').test('README.md'), true);
  assert.equal(globToRegExp('**.md').test('docs/deep/README.md'), true);
  assert.equal(globToRegExp('api/**').test('api/server/index.js'), true);
  assert.equal(globToRegExp('api/**').test('client/src/main.jsx'), false);
  assert.equal(globToRegExp('.github/workflows/*.yml').test('.github/workflows/ci-gate.yml'), true);
  assert.equal(
    globToRegExp('.github/workflows/*.yml').test('.github/workflows/nested/ci-gate.yml'),
    false,
  );
  assert.equal(globToRegExp('**/eslint-suppressions.json').test('eslint-suppressions.json'), true);
  assert.equal(
    globToRegExp('**/eslint-suppressions.json').test('packages/api/eslint-suppressions.json'),
    true,
  );
  // A literal glob must not behave like a regular expression.
  assert.equal(globToRegExp('eslint.config.mjs').test('eslintXconfig.mjs'), false);
});

test('matchesFilter applies positives and exclusions together', () => {
  assert.equal(matchesFilter(null, ['anything.ts']), true);
  assert.equal(matchesFilter([], ['anything.ts']), true);

  const sourceOnly = ['api/**', 'client/**', '!**.md'];
  assert.equal(matchesFilter(sourceOnly, ['api/server/index.js']), true);
  assert.equal(matchesFilter(sourceOnly, ['docs/README.md']), false);

  // One passing file is enough even when another file is excluded.
  assert.equal(matchesFilter(sourceOnly, ['docs/README.md', 'client/src/main.jsx']), true);

  // A list of only negative patterns means "everything except".
  assert.equal(matchesFilter(['!**.md'], ['api/server/index.js']), true);
  assert.equal(matchesFilter(['!**.md'], ['docs/README.md']), false);

  // Branch globs use the same matcher.
  assert.equal(matchesFilter(['main', 'release/*'], ['release/2.0']), true);
  assert.equal(matchesFilter(['main'], ['feature/x']), false);
});

test('parseWorkflow reads block, inline and scalar triggers', () => {
  const block = parseWorkflow(
    [
      'name: Static Checks',
      '',
      'on:',
      '  pull_request:',
      '    paths:',
      "      - 'api/**'",
      "      - '!.md'",
      '      - "packages/**"',
      '  workflow_dispatch:',
      '',
      'permissions:',
      '  contents: read',
    ].join('\n'),
    '.github/workflows/static-checks.yml',
  );
  assert.equal(block.name, 'Static Checks');
  assert.deepEqual(block.pullRequest.paths, ['api/**', '!.md', 'packages/**']);
  assert.equal(block.pullRequest.branches, null);

  const inline = parseWorkflow(
    ['name: ci', 'on:', '  pull_request:', '    branches: [main]'].join('\n'),
    '.github/workflows/ci.yml',
  );
  assert.deepEqual(inline.pullRequest.branches, ['main']);

  const scalar = parseWorkflow('name: verify\n\non: [push, pull_request]\n', '.github/workflows/v.yml');
  assert.deepEqual(scalar.pullRequest, { paths: null, branches: null, types: null });

  const pushOnly = parseWorkflow('name: Release\n\non:\n  push:\n    tags:\n      - "v*"\n', 'p.yml');
  assert.equal(pushOnly.pullRequest, null);
});

test('the gate workflow keeps no path filter, so the required check always reports', async () => {
  const workflows = await loadWorkflows(WORKFLOWS_DIRECTORY);
  const gate = workflows.find((workflow) => workflow.path === SELF_PATH);

  assert.ok(gate, 'ci-gate.yml must exist');
  assert.ok(gate.pullRequest, 'ci-gate.yml must run on pull_request');
  assert.equal(
    gate.pullRequest.paths,
    null,
    'ci-gate.yml must not be path-filtered; a filtered gate leaves the required check pending',
  );
});

test('every workflow in the repository parses', async () => {
  const workflows = await loadWorkflows(WORKFLOWS_DIRECTORY);
  assert.ok(workflows.length > 30, `expected the full workflow directory, saw ${workflows.length}`);
  for (const workflow of workflows) {
    assert.ok(workflow.name.length > 0, `${workflow.path} has no name`);
    assert.ok(!workflow.name.startsWith('name:'), `${workflow.path} name was not stripped`);
  }
});

test('component filters match the paths they declare', async () => {
  const workflows = await loadWorkflows(WORKFLOWS_DIRECTORY);
  const byPath = new Map(workflows.map((workflow) => [workflow.path, workflow]));
  const advisoryPaths = new Set(
    workflows
      .filter((workflow) => ADVISORY_WORKFLOW_NAMES.has(workflow.name))
      .map((workflow) => workflow.path),
  );

  const plan = (changedFiles) =>
    planGate({
      workflows,
      changedFiles,
      baseRef: 'main',
      advisoryPaths,
      selfPath: SELF_PATH,
      startedRuns: new Map(),
    });

  const staticChecks = byPath.get('.github/workflows/static-checks.yml');
  assert.ok(staticChecks.pullRequest.paths.includes('api/**'));

  const documentationOnly = plan(['docs/README.md']);
  assert.equal(
    documentationOnly.expected.has('.github/workflows/static-checks.yml'),
    false,
    'a markdown-only diff must not require Static Checks',
  );

  const backendChange = plan(['api/server/index.js']);
  assert.equal(
    backendChange.expected.has('.github/workflows/static-checks.yml'),
    true,
    'an api change must require Static Checks',
  );
  assert.equal(
    backendChange.expected.has('.github/workflows/frontend-review.yml'),
    false,
    'an api-only change must not require Frontend Unit Tests',
  );
});

test('planGate unions applied filters with workflows that started anyway', () => {
  const workflows = [
    { name: 'Applies', path: 'a.yml', pullRequest: { paths: ['api/**'], branches: null, types: null } },
    { name: 'Skips', path: 'b.yml', pullRequest: { paths: ['client/**'], branches: null, types: null } },
    { name: 'Push only', path: 'c.yml', pullRequest: null },
    { name: 'Advisory', path: 'd.yml', pullRequest: { paths: ['**'], branches: null, types: null } },
    { name: 'Self', path: SELF_PATH, pullRequest: { paths: null, branches: null, types: null } },
  ];
  const startedRuns = new Map([
    ['b.yml', { name: 'Skips', status: 'completed', conclusion: 'success', run_attempt: 1, id: 2 }],
    ['e.yml', { name: 'Unfiltered surprise', status: 'completed', conclusion: 'failure', run_attempt: 1, id: 3 }],
  ]);

  const plan = planGate({
    workflows,
    changedFiles: ['api/server/index.js'],
    baseRef: 'main',
    advisoryPaths: new Set(['d.yml']),
    selfPath: SELF_PATH,
    startedRuns,
  });

  assert.deepEqual([...plan.expected.keys()].sort(), ['a.yml', 'b.yml', 'e.yml']);
  assert.deepEqual(
    plan.notApplicable.map((entry) => entry.path),
    ['c.yml'],
  );
  // Advisory workflows never become required, whether or not their filter matches.
  assert.equal(plan.expected.has('d.yml'), false);
  assert.deepEqual(
    plan.filteredOut.map((entry) => entry.path),
    ['b.yml'],
  );
});

test('planGate honours a branch filter', () => {
  const workflows = [
    { name: 'Main only', path: 'a.yml', pullRequest: { paths: null, branches: ['main'], types: null } },
    { name: 'Release too', path: 'b.yml', pullRequest: { paths: null, branches: ['main', 'release/*'], types: null } },
  ];
  const plan = planGate({
    workflows,
    changedFiles: ['anything.ts'],
    baseRef: 'release/2.0',
    advisoryPaths: new Set(),
    selfPath: SELF_PATH,
    startedRuns: new Map(),
  });
  assert.deepEqual([...plan.expected.keys()], ['b.yml']);
});

test('evaluateGate separates passing, failing, pending and missing', () => {
  const expected = new Map([
    ['ok.yml', 'Ok'],
    ['skip.yml', 'Skip'],
    ['neutral.yml', 'Neutral'],
    ['fail.yml', 'Fail'],
    ['cancel.yml', 'Cancel'],
    ['running.yml', 'Running'],
    ['absent.yml', 'Absent'],
  ]);
  const runs = new Map([
    ['ok.yml', { status: 'completed', conclusion: 'success' }],
    ['skip.yml', { status: 'completed', conclusion: 'skipped' }],
    ['neutral.yml', { status: 'completed', conclusion: 'neutral' }],
    ['fail.yml', { status: 'completed', conclusion: 'failure' }],
    ['cancel.yml', { status: 'completed', conclusion: 'cancelled' }],
    ['running.yml', { status: 'in_progress', conclusion: null }],
  ]);

  const gate = evaluateGate(expected, runs);
  assert.deepEqual(
    gate.passing.map((entry) => entry.path),
    ['ok.yml', 'skip.yml', 'neutral.yml'],
  );
  assert.deepEqual(
    gate.failing.map((entry) => entry.path),
    ['fail.yml', 'cancel.yml'],
  );
  assert.deepEqual(
    gate.pending.map((entry) => entry.path),
    ['running.yml'],
  );
  assert.deepEqual(
    gate.missing.map((entry) => entry.path),
    ['absent.yml'],
  );
});

test('indexRunsByWorkflow keeps the highest re-run attempt', () => {
  const runs = indexRunsByWorkflow([
    { path: 'a.yml', id: 10, run_attempt: 1, status: 'completed', conclusion: 'failure' },
    { path: 'a.yml', id: 10, run_attempt: 2, status: 'completed', conclusion: 'success' },
    { path: 'b.yml', id: 11, run_attempt: 1, status: 'completed', conclusion: 'success' },
  ]);
  assert.equal(runs.get('a.yml').conclusion, 'success');
  assert.equal(runs.get('b.yml').conclusion, 'success');
});
