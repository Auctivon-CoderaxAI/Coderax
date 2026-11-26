import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import yaml from 'js-yaml';
import { evaluate, loadManifest } from './ci-gate.mjs';

const manifest = {
  required: [
    {
      label: 'Static checks',
      workflow: 'static-checks.yml',
      pathFiltered: true,
      patterns: ['Static checks'],
    },
  ],
  reportOnly: [],
};

const lane = (overrides = {}) => ({
  checks: [{ name: 'Static checks', status: 'completed', conclusion: 'success' }],
  runs: { 'static-checks.yml': 1 },
  settled: true,
  ...overrides,
});

const run = (overrides = {}) => evaluate({ manifest, ...lane(overrides) });

test('passes when a required lane succeeded', () => {
  const state = run();
  assert.deepEqual(state.failures, []);
  assert.equal(state.pending, false);
});

test('fails when a required lane failed', () => {
  const state = run({
    checks: [{ name: 'Static checks', status: 'completed', conclusion: 'failure' }],
  });
  assert.equal(state.failures.length, 1);
  assert.equal(state.failures[0].state, 'failed');
  assert.match(state.failures[0].detail, /Static checks \(failure\)/);
});

test('fails when a required lane completed as skipped', () => {
  const state = run({
    checks: [{ name: 'Static checks', status: 'completed', conclusion: 'skipped' }],
  });
  assert.equal(state.failures.length, 1);
  assert.equal(state.failures[0].state, 'skipped');
});

test('reports pending while a required lane is still running', () => {
  const state = run({
    checks: [{ name: 'Static checks', status: 'in_progress', conclusion: null }],
  });
  assert.equal(state.pending, true);
  assert.deepEqual(state.failures, []);
});

test('passes an absent lane when its path-filtered workflow never started', () => {
  const state = run({ checks: [], runs: {} });
  assert.deepEqual(state.failures, []);
  assert.equal(state.pending, false);
});

test('keeps an absent path-filtered lane pending until the settle window elapses', () => {
  const state = run({ checks: [], runs: {}, settled: false });
  assert.equal(state.pending, true);
  assert.deepEqual(state.failures, []);
});

test('fails an absent lane when its workflow ran at this head', () => {
  const state = run({ checks: [], runs: { 'static-checks.yml': 2 } });
  assert.equal(state.failures.length, 1);
  assert.equal(state.failures[0].state, 'missing');
});

test('fails an absent lane when the workflow declares no path filter', () => {
  const state = evaluate({
    manifest: {
      required: [
        { label: 'Always', workflow: 'always.yml', pathFiltered: false, patterns: ['Always'] },
      ],
    },
    checks: [],
    runs: {},
    settled: true,
  });
  assert.equal(state.failures.length, 1);
  assert.equal(state.failures[0].state, 'missing');
});

test('treats a neutral conclusion as a pass', () => {
  const state = run({
    checks: [{ name: 'Static checks', status: 'completed', conclusion: 'neutral' }],
  });
  assert.deepEqual(state.failures, []);
});

test('matches every shard of a matrix job by its name prefix', () => {
  const state = evaluate({
    manifest: {
      required: [
        {
          label: 'End to end',
          workflow: 'playwright-mock.yml',
          pathFiltered: true,
          patterns: ['e2e (memory, shard'],
        },
      ],
    },
    checks: [
      { name: 'e2e (memory, shard 1/6)', status: 'completed', conclusion: 'success' },
      { name: 'e2e (memory, shard 2/6)', status: 'completed', conclusion: 'failure' },
    ],
    runs: { 'playwright-mock.yml': 1 },
    settled: true,
  });
  assert.equal(state.failures.length, 1);
  assert.match(state.failures[0].detail, /shard 2\/6/);
});

test('the committed manifest names real workflows that trigger on pull requests', () => {
  const committed = loadManifest(process.cwd());
  const lanes = [...committed.required, ...(committed.reportOnly ?? [])];
  assert.ok(lanes.length > 0);
  assert.equal(new Set(lanes.map((item) => item.label)).size, lanes.length, 'duplicate labels');

  for (const item of lanes) {
    let source;
    try {
      source = readFileSync(`.github/workflows/${item.workflow}`, 'utf8');
    } catch (error) {
      assert.ok(item.optional, `${item.workflow} must exist unless the lane is marked optional`);
      continue;
    }
    const parsed = yaml.load(source);
    const on = parsed.on ?? parsed[true];
    const pullRequest = on?.pull_request;
    assert.ok(pullRequest, `${item.workflow} must trigger on pull_request`);
    if (item.pathFiltered) {
      const paths = pullRequest.paths ?? pullRequest['paths-ignore'];
      assert.ok(
        Array.isArray(paths) && paths.length > 0,
        `${item.workflow} is declared path-filtered but declares no paths`,
      );
    }
    assert.ok(item.patterns?.length > 0, `${item.workflow} must list at least one pattern`);
  }
});

test('every required workflow is named by a lane', () => {
  const committed = loadManifest(process.cwd());
  const named = new Set(
    [...committed.required, ...(committed.reportOnly ?? [])].map((l) => l.workflow),
  );
  for (const workflow of [
    'static-checks.yml',
    'frontend-review.yml',
    'backend-review.yml',
    'cache-integration-tests.yml',
    'a11y.yml',
    'lighthouse.yml',
  ]) {
    assert.ok(named.has(workflow), `${workflow} must be covered by the gate`);
  }
});
