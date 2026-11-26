import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULTS, classify, evaluate } from './ci-gate.mjs';

const config = { ...DEFAULTS, registrationMs: 60_000, settleMs: 30_000, timeoutMs: 600_000 };

function run(id, name, status = 'completed', conclusion = 'success', app = 'github-actions') {
  return { id, name, status, conclusion, app: { slug: app } };
}

/**
 * A snapshot whose clock defaults to "both windows have elapsed", so each test
 * only has to state the timing it is actually about.
 */
function at(now, options = {}) {
  const {
    runs = [],
    statuses = [],
    sinceStart = config.registrationMs,
    sinceChange = config.settleMs,
    ...rest
  } = options;
  return {
    runs,
    statuses,
    now,
    startedAt: now - sinceStart,
    lastChangeAt: now - sinceChange,
    config,
    ...rest,
  };
}

test('a pull request that triggers no path-filtered workflow passes after the registration window', () => {
  const early = evaluate(at(10_000, { sinceStart: 5_000 }));
  assert.equal(early.decision, 'wait');

  const settled = evaluate(at(70_000));
  assert.equal(settled.decision, 'pass');
  assert.match(settled.reason, /No component workflow applied/);
});

test('the gate excludes its own check run instead of waiting on itself', () => {
  const runs = [run(1, 'CI gate (aggregate)', 'in_progress', null), run(2, 'Static checks')];
  const checks = classify(runs);
  assert.equal(checks.observed.length, 1);
  assert.equal(checks.pending.length, 0);

  const result = evaluate(at(40_000, { runs }));
  assert.equal(result.decision, 'pass');
});

test('a failed component fails the gate even while another is still running', () => {
  const runs = [run(1, 'Static checks', 'completed', 'failure'), run(2, 'Tests', 'in_progress', null)];
  const result = evaluate(at(10_000, { runs }));
  assert.equal(result.decision, 'fail');
  assert.match(result.reason, /Static checks \(failure\)/);
});

test('a pending component keeps the gate waiting, then passes when it succeeds', () => {
  const pending = evaluate(at(10_000, { runs: [run(1, 'Static checks', 'queued', null)] }));
  assert.equal(pending.decision, 'wait');

  const done = evaluate(at(10_000, { runs: [run(1, 'Static checks')] }));
  assert.equal(done.decision, 'pass');
});

test('skipped and neutral checks pass, because path-filtered jobs report skipped', () => {
  const runs = [
    run(1, 'Static checks', 'completed', 'skipped'),
    run(2, 'Lighthouse', 'completed', 'neutral'),
    run(3, 'Client', 'completed', 'success'),
  ];
  const result = evaluate(at(10_000, { runs }));
  assert.equal(result.decision, 'pass');
  assert.equal(result.counts.failing, 0);
});

test('a third-party preview check cannot decide whether code merges', () => {
  const runs = [
    run(1, 'Static checks'),
    run(2, 'Workers Builds: coderax', 'completed', 'failure', 'cloudflare-workers-and-pages'),
  ];
  const result = evaluate(at(10_000, { runs }));
  assert.equal(result.decision, 'pass');
  assert.equal(result.counts.observed, 1);
});

test('a completed check with no conclusion is treated as a failure, not a pass', () => {
  const runs = [
    { id: 1, name: 'Static checks', status: 'completed', conclusion: null, app: { slug: 'github-actions' } },
  ];
  const result = evaluate(at(10_000, { runs }));
  assert.equal(result.decision, 'fail');
  assert.match(result.reason, /unknown/);
});

test('every blocking conclusion fails the gate', () => {
  for (const conclusion of [
    'failure',
    'timed_out',
    'cancelled',
    'action_required',
    'startup_failure',
  ]) {
    const result = evaluate(at(10_000, { runs: [run(1, 'Tests', 'completed', conclusion)] }));
    assert.equal(result.decision, 'fail', `${conclusion} must fail the gate`);
  }
});

test('commit statuses are evaluated alongside check runs', () => {
  const failed = evaluate(at(10_000, { statuses: [{ context: 'ci/legacy', state: 'failure' }] }));
  assert.equal(failed.decision, 'fail');

  const pending = evaluate(at(10_000, { statuses: [{ context: 'ci/legacy', state: 'pending' }] }));
  assert.equal(pending.decision, 'wait');

  const passed = evaluate(at(10_000, { statuses: [{ context: 'ci/legacy', state: 'success' }] }));
  assert.equal(passed.decision, 'pass');
});

test('a late registration resets the settle window', () => {
  const first = evaluate(at(10_000, { runs: [run(1, 'Static checks')], sinceChange: 0 }));
  assert.equal(first.decision, 'wait');

  const late = evaluate(
    at(12_000, {
      runs: [run(1, 'Static checks'), run(2, 'Client')],
      previousSignature: first.signature,
      lastChangeAt: first.lastChangeAt,
    }),
  );
  assert.equal(late.decision, 'wait');
  assert.equal(late.lastChangeAt, 12_000);
});

test('the gate fails rather than hanging when the budget is exhausted', () => {
  const result = evaluate(
    at(700_000, {
      runs: [run(1, 'Tests', 'in_progress', null)],
      sinceStart: 700_000,
      timeoutMs: 600_000,
    }),
  );
  assert.equal(result.decision, 'fail');
  assert.match(result.reason, /Timed out/);
});

test('an unparsable payload is a quiet snapshot, never a crash', () => {
  assert.equal(classify(undefined).observed.length, 0);
  assert.equal(evaluate(at(10_000, { runs: undefined, statuses: undefined })).decision, 'pass');
});
