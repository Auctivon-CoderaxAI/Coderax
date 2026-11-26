import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import yaml from 'js-yaml';
import { collect, evaluate, loadManifest } from './ci-gate.mjs';

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

const workflowRuns = (workflow, suiteId = 1, status = 'completed') =>
  new Map([[workflow, [{ suiteId, status }]]]);

const lane = (overrides = {}) => ({
  checks: [{ name: 'Static checks', suiteId: 1, status: 'completed', conclusion: 'success' }],
  runs: workflowRuns('static-checks.yml'),
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
    checks: [{ name: 'Static checks', suiteId: 1, status: 'completed', conclusion: 'failure' }],
  });
  assert.equal(state.failures.length, 1);
  assert.equal(state.failures[0].state, 'failed');
  assert.match(state.failures[0].detail, /Static checks \(failure\)/);
});

test('fails when a required lane completed as skipped', () => {
  const state = run({
    checks: [{ name: 'Static checks', suiteId: 1, status: 'completed', conclusion: 'skipped' }],
  });
  assert.equal(state.failures.length, 1);
  assert.equal(state.failures[0].state, 'skipped');
});

test('reports pending while a required lane is still running', () => {
  const state = run({
    checks: [{ name: 'Static checks', suiteId: 1, status: 'in_progress', conclusion: null }],
  });
  assert.equal(state.pending, true);
  assert.deepEqual(state.failures, []);
});

test('passes an absent lane when its path-filtered workflow never started', () => {
  const state = run({ checks: [], runs: new Map() });
  assert.deepEqual(state.failures, []);
  assert.equal(state.pending, false);
});

test('keeps an absent path-filtered lane pending until the settle window elapses', () => {
  const state = run({ checks: [], runs: new Map(), settled: false });
  assert.equal(state.pending, true);
  assert.deepEqual(state.failures, []);
});

test('waits while an owning workflow is running even after the settle window', () => {
  const state = run({ checks: [], runs: workflowRuns('static-checks.yml', 1, 'in_progress') });
  assert.equal(state.pending, true);
  assert.deepEqual(state.failures, []);
});

test('does not pass on a previous success while its owning workflow is running again', () => {
  const state = run({ runs: workflowRuns('static-checks.yml', 1, 'in_progress') });
  assert.equal(state.pending, true);
  assert.deepEqual(state.failures, []);
});

test('confirms an absent check in a later snapshot of the completed workflow', () => {
  const first = run({ checks: [], settled: false });
  assert.equal(first.pending, true);
  assert.deepEqual(first.failures, []);
  assert.deepEqual(run({ previousMissing: first.observedMissing }).failures, []);
  const state = run({ checks: [], previousMissing: first.observedMissing });
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
    runs: new Map(),
    settled: true,
  });
  assert.equal(state.failures.length, 1);
  assert.equal(state.failures[0].state, 'missing');
});

test('treats a neutral conclusion as a pass', () => {
  const state = run({
    checks: [{ name: 'Static checks', suiteId: 1, status: 'completed', conclusion: 'neutral' }],
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
      { name: 'e2e (memory, shard 1/6)', suiteId: 1, status: 'completed', conclusion: 'success' },
      { name: 'e2e (memory, shard 2/6)', suiteId: 1, status: 'completed', conclusion: 'failure' },
    ],
    runs: workflowRuns('playwright-mock.yml'),
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
  const named = new Set(committed.required.map((l) => l.workflow));
  for (const workflow of [
    'static-checks.yml',
    'frontend-review.yml',
    'backend-review.yml',
    'cache-integration-tests.yml',
    'agents-integration-tests.yml',
    'a11y.yml',
    'lighthouse.yml',
  ]) {
    assert.ok(named.has(workflow), `${workflow} must be covered by the gate`);
  }
});

test('a same-prefix check from another workflow cannot satisfy a missing backend check', async (t) => {
  const checks = [
    { name: 'TypeScript type checks (client)', check_suite: { id: 1 }, conclusion: 'success' },
    { name: 'Renamed backend typecheck', check_suite: { id: 2 }, conclusion: 'failure' },
  ];
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.includes('/check-runs?')) {
      return Response.json({
        check_runs: checks.map((check) => ({ ...check, status: 'completed' })),
      });
    }
    assert.match(url, /head_sha=expected-head&event=pull_request/);
    const page = Number(new URL(url).searchParams.get('page'));
    const workflow_runs =
      page <= 5
        ? Array.from({ length: 100 }, (_, index) => ({
            id: (page - 1) * 100 + index + 1,
            path: '.github/workflows/frontend-review.yml',
            check_suite_id: 1,
            status: 'completed',
          }))
        : [
            {
              id: 501,
              path: '.github/workflows/backend-review.yml',
              check_suite_id: 2,
              status: 'completed',
            },
          ];
    return Response.json({ total_count: 501, workflow_runs });
  });

  const committed = loadManifest(process.cwd());
  const required = committed.required
    .filter((lane) => ['frontend-review.yml', 'backend-review.yml'].includes(lane.workflow))
    .map((lane) => ({ ...lane, patterns: [lane.patterns[0]] }));
  const collected = await collect('owner/repo', 'expected-head', 'test-token');
  const input = { manifest: { required }, ...collected, settled: true };
  const first = evaluate(input);
  assert.equal(first.pending, true);
  const second = evaluate({ ...input, previousMissing: first.observedMissing });
  assert.deepEqual(
    second.failures.map(({ workflow, state }) => [workflow, state]),
    [['backend-review.yml', 'missing']],
  );
});

test('rejects a truncated workflow run listing before evaluating lane absence', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) =>
    Response.json(
      url.includes('/check-runs?') ? { check_runs: [] } : { total_count: 2, workflow_runs: [] },
    ),
  );
  await assert.rejects(collect('owner/repo', 'expected-head', 'test-token'), {
    message: 'Incomplete workflow run listing: expected 2, saw 0',
  });
});

test('a Redis-only change does not require a check from the separate agent workflow', () => {
  const workflow = 'cache-integration-tests.yml';
  const required = loadManifest(process.cwd()).required.filter((lane) =>
    [workflow, 'agents-integration-tests.yml'].includes(lane.workflow),
  );
  assert.equal(required.length, 2);
  const input = {
    manifest: { required },
    checks: [
      {
        name: 'Integration Tests that use actual Redis Cache',
        suiteId: 1,
        status: 'completed',
        conclusion: 'success',
      },
    ],
    runs: workflowRuns(workflow),
    settled: true,
  };
  const state = evaluate(input);
  assert.equal(state.pending, false);
  assert.deepEqual(state.failures, []);
  assert.equal(state.required[1].findings[0].state, 'filtered');
});
