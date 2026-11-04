import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  classifyCheckRun,
  evaluateReleaseGate,
  formatReleaseGate,
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
  assert.equal(
    classifyCheckRun({ ...actionsCheck(), app: { slug: 'vercel' }, steps: [] }),
    'pass',
  );
});

test('a failed Actions check with no executed steps is BLOCKED, not a code failure', () => {
  assert.equal(
    classifyCheckRun(actionsCheck({ conclusion: 'failure', steps: [] })),
    'blocked',
  );
});

test('a failed or cancelled check that executed steps is a real failure', () => {
  assert.equal(
    classifyCheckRun(actionsCheck({ conclusion: 'failure' })),
    'fail',
  );
  assert.equal(
    classifyCheckRun(actionsCheck({ conclusion: 'cancelled' })),
    'fail',
  );
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
    checkRuns: [
      actionsCheck(),
      actionsCheck({ id: 2, name: 'Tests', steps: [{ name: 'jest' }] }),
    ],
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
    started_at: '2026-11-03T09:00:00Z',
    completed_at: '2026-11-03T09:05:00Z',
  });
  const newerSuccess = actionsCheck({
    id: 2,
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
