import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  classifyCheckRun,
  evaluateReleaseGate,
  formatReleaseGate,
  loadCheckRuns,
  parseArgs,
  parseRequired,
} from './verify-release-gate.mjs';

const actionsCheck = (overrides = {}) => ({
  id: 1,
  name: 'Static checks',
  status: 'completed',
  conclusion: 'success',
  app: { slug: 'github-actions' },
  steps: [{ name: 'Run checks', conclusion: 'success' }],
  started_at: '2026-11-03T10:00:00Z',
  completed_at: '2026-11-03T10:10:00Z',
  ...overrides,
});

test('a completed successful Actions check passes whether or not steps are listed', () => {
  assert.equal(classifyCheckRun(actionsCheck()), 'pass');
  assert.equal(classifyCheckRun(actionsCheck({ steps: [] })), 'pass');
});

test('a successful non-Actions check passes without steps', () => {
  assert.equal(classifyCheckRun({ ...actionsCheck(), app: { slug: 'vercel' }, steps: [] }), 'pass');
});

test('a failed Actions check with no executed steps is BLOCKED, not a code failure', () => {
  assert.equal(classifyCheckRun(actionsCheck({ conclusion: 'failure', steps: [] })), 'blocked');
});

test('an Actions failure without fetchable steps is a failure, not a runner block', () => {
  assert.equal(classifyCheckRun(actionsCheck({ conclusion: 'failure', steps: undefined })), 'fail');
});

test('a newer queued check does not lose to an older success', () => {
  const olderSuccess = actionsCheck({
    id: 1,
    completed_at: '2026-11-03T10:10:00Z',
  });
  const newerPending = actionsCheck({
    id: 2,
    status: 'queued',
    conclusion: null,
    started_at: null,
    completed_at: null,
  });

  const gate = evaluateReleaseGate({
    sha: 'f'.repeat(40),
    required: ['Static checks'],
    checkRuns: [olderSuccess, newerPending],
  });

  assert.equal(gate.ok, false);
  assert.equal(gate.results[0].status, 'pending');
});

test('duplicate check names from different workflows are all evaluated', () => {
  const passing = actionsCheck({
    id: 2,
    name: 'Build packages',
    details_url: 'https://github.com/o/r/actions/runs/2/job/22',
  });
  const failing = actionsCheck({
    id: 1,
    name: 'Build packages',
    conclusion: 'failure',
    details_url: 'https://github.com/o/r/actions/runs/1/job/11',
  });

  const gate = evaluateReleaseGate({
    sha: '1'.repeat(40),
    required: ['Build packages'],
    checkRuns: [passing, failing],
  });

  assert.equal(gate.ok, false);
  assert.equal(gate.results[0].status, 'fail');
  assert.match(gate.results[0].detail, /2 matching checks evaluated/);
});

test('loadCheckRuns fetches workflow job steps for failed Actions checks', () => {
  const calls = [];
  const exec = (args) => {
    calls.push(args);
    if (args[1] === '--paginate') {
      return JSON.stringify([
        {
          check_runs: [
            actionsCheck({
              id: 5,
              name: 'Build packages',
              conclusion: 'failure',
              details_url: 'https://github.com/CoderaxAI/Coderax/actions/runs/9/job/77',
            }),
            actionsCheck({ id: 6, name: 'Static checks' }),
          ],
        },
      ]);
    }
    if (args[1]?.includes('/actions/runs/9')) {
      return JSON.stringify({ workflow_id: 42, run_attempt: 1 });
    }
    if (args[1]?.includes('/actions/jobs/77')) {
      return JSON.stringify({ steps: [{ name: 'Build packages' }] });
    }
    throw new Error(`Unexpected gh call: ${args.join(' ')}`);
  };

  const checks = loadCheckRuns('CoderaxAI/Coderax', 'a'.repeat(40), exec);

  assert.deepEqual(checks[0].steps, [{ name: 'Build packages' }]);
  assert.equal(checks[0].workflow_id, 42);
  assert.equal(checks[0].workflow_run_id, 9);
  assert.equal(calls.filter((args) => args[1]?.includes('/actions/jobs/')).length, 1);
});

test('a failed or cancelled check that executed steps is a real failure', () => {
  assert.equal(classifyCheckRun(actionsCheck({ conclusion: 'failure' })), 'fail');
  assert.equal(classifyCheckRun(actionsCheck({ conclusion: 'cancelled' })), 'fail');
});

test('an incomplete check is pending', () => {
  assert.equal(
    classifyCheckRun(actionsCheck({ status: 'in_progress', conclusion: null })),
    'pending',
  );
});

test('the gate passes only when every required check executed and passed', () => {
  const gate = evaluateReleaseGate({
    sha: 'a'.repeat(40),
    required: ['Static checks', 'Tests'],
    checkRuns: [actionsCheck(), actionsCheck({ id: 2, name: 'Tests', steps: [{ name: 'jest' }] })],
  });

  assert.equal(gate.ok, true);
  assert.deepEqual(
    gate.results.map((result) => result.status),
    ['pass', 'pass'],
  );
});

test('a zero-step runner block fails closed with the GitHub annotation', () => {
  const gate = evaluateReleaseGate({
    sha: 'b'.repeat(40),
    required: ['Static checks'],
    checkRuns: [
      actionsCheck({
        id: 7,
        conclusion: 'failure',
        steps: [],
      }),
    ],
    annotations: {
      7: [
        {
          message:
            'The job was not started because recent account payments have failed or your spending limit needs to be increased.',
        },
      ],
    },
  });

  assert.equal(gate.ok, false);
  assert.equal(gate.results[0].status, 'blocked');
  assert.match(gate.results[0].detail, /account payments have failed/);
});

test('a missing required check is not treated as a pass', () => {
  const gate = evaluateReleaseGate({
    sha: 'c'.repeat(40),
    required: ['Static checks', 'Guest streaming E2E'],
    checkRuns: [actionsCheck()],
  });

  assert.equal(gate.ok, false);
  assert.equal(gate.results[1].status, 'missing');
});

test('the newest run for a repeated check name is the one evaluated', () => {
  const olderFailure = actionsCheck({
    id: 1,
    conclusion: 'failure',
    details_url: 'https://github.com/o/r/actions/runs/1/job/1',
    started_at: '2026-11-03T09:00:00Z',
    completed_at: '2026-11-03T09:05:00Z',
  });
  const newerSuccess = actionsCheck({
    id: 2,
    details_url: 'https://github.com/o/r/actions/runs/1/job/2',
    started_at: '2026-11-03T10:00:00Z',
    completed_at: '2026-11-03T10:05:00Z',
  });

  const gate = evaluateReleaseGate({
    sha: 'd'.repeat(40),
    required: ['Static checks'],
    checkRuns: [newerSuccess, olderFailure],
  });

  assert.equal(gate.ok, true);
  assert.equal(gate.results[0].status, 'pass');
});

test('required names are trimmed, deduplicated, and must be non-empty', () => {
  assert.deepEqual(parseRequired(' Static checks, Tests ,Static checks,'), [
    'Static checks',
    'Tests',
  ]);
  assert.deepEqual(parseRequired(''), []);
  assert.throws(
    () =>
      evaluateReleaseGate({
        sha: 'e'.repeat(40),
        required: [],
        checkRuns: [],
      }),
    /at least one check/,
  );
});

test('CLI arguments default to the canonical repo and reject unknown flags', () => {
  const args = parseArgs(['--sha', 'abcdef1', '--require', 'Static checks']);
  assert.equal(args.repo, 'CoderaxAI/Coderax');
  assert.equal(args.sha, 'abcdef1');
  assert.deepEqual(args.required, ['Static checks']);
  assert.throws(() => parseArgs(['--wat']), /Unknown argument/);
});

test('the formatted result names every check and the final gate state', () => {
  const text = formatReleaseGate({
    sha: 'abcdef1',
    ok: false,
    results: [
      { name: 'Static checks', status: 'pass', detail: 'Executed and passed.' },
      {
        name: 'Build packages',
        status: 'blocked',
        detail: 'The job did not execute any steps.',
      },
    ],
  });

  assert.match(text, /PASS\s+Static checks/);
  assert.match(text, /BLOCKED\s+Build packages/);
  assert.match(text, /Release gate FAILED at abcdef1: 1 of 2/);
});

test('a newer successful run of the same workflow supersedes its old failure', () => {
  const oldBlocked = actionsCheck({
    id: 10,
    name: 'Build packages',
    conclusion: 'failure',
    steps: [],
    workflow_id: 42,
    workflow_run_id: 100,
    details_url: 'https://github.com/o/r/actions/runs/100/job/10',
  });
  const newSuccess = actionsCheck({
    id: 11,
    name: 'Build packages',
    workflow_id: 42,
    workflow_run_id: 101,
    details_url: 'https://github.com/o/r/actions/runs/101/job/11',
  });
  const gate = evaluateReleaseGate({
    sha: 'a'.repeat(40),
    required: ['Build packages'],
    checkRuns: [newSuccess, oldBlocked],
  });
  assert.equal(gate.ok, true);
  assert.equal(gate.results[0].status, 'pass');
});

test('newer pending run cannot be masked by an older workflow success', () => {
  const older = actionsCheck({
    id: 21,
    workflow_id: 42,
    workflow_run_id: 100,
  });
  const newer = actionsCheck({
    id: 22,
    status: 'queued',
    conclusion: null,
    started_at: null,
    completed_at: null,
    workflow_id: 42,
    workflow_run_id: 101,
  });
  const gate = evaluateReleaseGate({
    sha: 'b'.repeat(40),
    required: ['Static checks'],
    checkRuns: [older, newer],
  });
  assert.equal(gate.ok, false);
  assert.equal(gate.results[0].status, 'pending');
});

test('different workflows sharing a check name are evaluated independently', () => {
  const passing = actionsCheck({
    id: 31,
    name: 'Build packages',
    workflow_id: 42,
    workflow_run_id: 101,
  });
  const failing = actionsCheck({
    id: 32,
    name: 'Build packages',
    conclusion: 'failure',
    workflow_id: 43,
    workflow_run_id: 102,
  });
  const gate = evaluateReleaseGate({
    sha: 'c'.repeat(40),
    required: ['Build packages'],
    checkRuns: [passing, failing],
  });
  assert.equal(gate.ok, false);
  assert.equal(gate.results[0].status, 'fail');
});

test('missing workflow identity preserves the old failure rather than guessing recovery', () => {
  const oldFailure = actionsCheck({
    id: 41,
    conclusion: 'failure',
    details_url: 'https://github.com/o/r/actions/runs/100/job/41',
    workflow_run_id: 100,
  });
  const newer = actionsCheck({
    id: 42,
    details_url: 'https://github.com/o/r/actions/runs/101/job/42',
    workflow_run_id: 101,
  });
  const gate = evaluateReleaseGate({
    sha: 'd'.repeat(40),
    required: ['Static checks'],
    checkRuns: [oldFailure, newer],
  });
  assert.equal(gate.ok, false);
  assert.equal(gate.results[0].status, 'fail');
});
