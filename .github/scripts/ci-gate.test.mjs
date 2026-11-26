import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DEFAULTS,
  GATE_CONTROL_PATHS,
  SELF_PATH,
  evaluateBootstrap,
  evaluateGate,
  evaluateGateChangeGuard,
  globToRegExp,
  latestReviews,
  loadWorkflows,
  matchesIgnoreFilter,
  matchesPathFilter,
  matchesRefFilter,
  mergeGroupSupport,
  parseCodeOwners,
  parseWorkflow,
  planGate,
  runGate,
  selectRun,
  verifyInstallation,
} from './ci-gate.mjs';

const config = {
  ...DEFAULTS,
  timeoutSeconds: 600,
  pollSeconds: 1,
  startGraceSeconds: 60,
  settleSeconds: 30,
  emptySettleSeconds: 30,
  retryBaseMs: 1,
};

function workflow(workflowPath, overrides = {}) {
  return {
    name: overrides.name ?? workflowPath,
    path: workflowPath,
    pullRequest: overrides.pullRequest ?? {
      paths: null,
      pathsIgnore: null,
      branches: null,
      branchesIgnore: null,
      types: null,
    },
    mergeGroup: overrides.mergeGroup ?? false,
  };
}

function run(overrides = {}) {
  return {
    id: 1,
    name: 'Alpha',
    path: '.github/workflows/alpha.yml',
    event: 'pull_request',
    head_sha: 'head-sha',
    status: 'completed',
    conclusion: 'success',
    run_attempt: 1,
    repository: { full_name: 'owner/repo' },
    pull_requests: [{ number: 1 }],
    ...overrides,
  };
}

function expectedOf(paths) {
  return new Map(
    paths.map((entry) => [
      entry,
      { name: entry, path: entry, requiredForMissing: true, observed: false },
    ]),
  );
}

function evaluate(overrides = {}) {
  const now = overrides.now ?? 1_000_000;
  return evaluateGate({
    expected: overrides.expected ?? expectedOf(['.github/workflows/alpha.yml']),
    runs: overrides.runs ?? [run()],
    statuses: overrides.statuses ?? [],
    now,
    startedAt: overrides.startedAt ?? now - config.settleSeconds * 1000,
    lastChangeAt: overrides.lastChangeAt ?? now - config.settleSeconds * 1000,
    firstMissingAt: overrides.firstMissingAt ?? new Map(),
    previousSignature: overrides.previousSignature,
    config,
    headSha: overrides.headSha ?? 'head-sha',
    event: overrides.event ?? 'pull_request',
    repository: overrides.repository ?? 'owner/repo',
    pullNumber: overrides.pullNumber ?? 1,
  });
}

test('glob translation keeps * inside a segment and lets ** cross segments', () => {
  assert.equal(globToRegExp('**/*.md').test('README.md'), true);
  assert.equal(globToRegExp('**/*.md').test('docs/deep/README.md'), true);
  assert.equal(globToRegExp('**/*.md').test('README.ts'), false);
  assert.equal(globToRegExp('client/src/**').test('client/src/a/b.ts'), true);
  assert.equal(globToRegExp('client/src/*.ts').test('client/src/a/b.ts'), false);
  const jsOrJsx = globToRegExp('src/*.jsx?');
  assert.equal(jsOrJsx.test('src/page.js'), true);
  assert.equal(jsOrJsx.test('src/page.jsx'), true);
  assert.equal(jsOrJsx.test('src/page.jsxz'), false);
  assert.equal(globToRegExp('src/page[ab]?.ts').test('src/page.ts'), true);
  assert.equal(globToRegExp('src/page[ab]?.ts').test('src/pageb.ts'), true);
  assert.equal(globToRegExp('src/[ab].ts').test('src/a.ts'), true);
  assert.equal(globToRegExp('src/[!ab].ts').test('src/c.ts'), true);
});

test('path filters combine positive and negative patterns', () => {
  assert.equal(matchesPathFilter(['client/src/**'], ['client/src/a.ts']), true);
  assert.equal(matchesPathFilter(['client/src/**'], ['docs/a.md']), false);
  assert.equal(
    matchesPathFilter(['client/src/**', '!**.md'], ['client/src/a.ts', 'client/src/a.md']),
    true,
  );
  assert.equal(matchesPathFilter(['client/src/**', '!**.md'], ['client/src/a.md']), false);
  assert.equal(matchesPathFilter(['!**.md'], ['docs/a.md']), false);
  assert.equal(matchesPathFilter(['!**.md'], ['src/a.ts']), true);
  assert.equal(matchesPathFilter(null, ['anything']), true);
  const include = 'src/**';
  const exclude = '!src/generated/**';
  const restore = 'src/generated/schema.ts';
  assert.equal(matchesPathFilter([include, exclude, restore], [restore]), true);
  assert.equal(matchesPathFilter([include, restore, exclude], [restore]), false);
  assert.equal(matchesPathFilter([include, exclude, restore], ['src/generated/other.ts']), false);
});

test('paths-ignore skips only when every changed file is ignored', () => {
  assert.equal(matchesIgnoreFilter(['**.md'], ['docs/a.md', 'README.md']), true);
  assert.equal(matchesIgnoreFilter(['**.md'], ['docs/a.md', 'src/a.ts']), false);
  assert.equal(matchesIgnoreFilter(null, ['docs/a.md']), false);
});

test('branch filters use the same glob rules', () => {
  assert.equal(matchesRefFilter(['main', 'release/*'], 'main'), true);
  assert.equal(matchesRefFilter(['main', 'release/*'], 'release/1.0'), true);
  assert.equal(matchesRefFilter(['main'], 'dev'), false);
  assert.equal(
    matchesRefFilter(
      ['release/**', '!release/private/**', 'release/private/main'],
      'release/private/main',
    ),
    true,
  );
});

test('the workflow parser reads inline triggers, block filters and comments', () => {
  const inline = parseWorkflow(
    'name: Inline\non: [push, pull_request]\n',
    '.github/workflows/inline.yml',
  );
  assert.equal(inline.pullRequest.paths, null);
  assert.equal(inline.mergeGroup, false);

  const block = parseWorkflow(
    [
      'name: Block',
      'on:',
      '  merge_group:',
      '  pull_request:',
      '    branches: [main, "release/*"]',
      '    paths:',
      "      - 'client/src/**'  # source",
      '      - "!**.md"',
      '    paths-ignore:',
      '      - docs/**',
      '    types: [opened, synchronize]',
    ].join('\n'),
    '.github/workflows/block.yml',
  );
  assert.deepEqual(block.pullRequest.branches, ['main', 'release/*']);
  assert.deepEqual(block.pullRequest.paths, ['client/src/**', '!**.md']);
  assert.deepEqual(block.pullRequest.pathsIgnore, ['docs/**']);
  assert.deepEqual(block.pullRequest.types, ['opened', 'synchronize']);
  assert.equal(block.mergeGroup, true);
});

test('empty inline trigger mappings work but nonempty inline filters are rejected', () => {
  const path = '.github/workflows/inline.yml';
  assert.equal(
    parseWorkflow('on:\n  "pull_request": { } # no filters\n', path).pullRequest.paths,
    null,
  );
  assert.throws(
    () => parseWorkflow("on:\n  pull_request: {paths: ['src/**']}\n", path),
    /use block syntax for pull_request filters/,
  );
  assert.throws(
    () => parseWorkflow("on: {pull_request: {paths: ['src/**']}}\n", path),
    /use block syntax for the on trigger mapping/,
  );
});

test('the parser sees every real pull-request workflow and keeps the gate unfiltered', async () => {
  const workflows = await loadWorkflows(fileURLToPath(new URL('../workflows/', import.meta.url)));
  const pullRequests = workflows.filter((entry) => entry.pullRequest);
  assert.equal(pullRequests.length, 21);

  const self = workflows.find((entry) => entry.path === SELF_PATH);
  assert.ok(self);
  assert.equal(self.pullRequest.paths, null);
  assert.equal(self.pullRequest.pathsIgnore, null);
  assert.equal(self.mergeGroup, true);
  assert.ok(self.jobNames.includes('CI gate (aggregate)'));

  const a11y = workflows.find((entry) => entry.path.endsWith('/a11y.yml'));
  assert.deepEqual(a11y.pullRequest.paths, ['client/src/**', '!**.md']);

  const agents = workflows.find((entry) => entry.path.endsWith('/agents-integration-tests.yml'));
  assert.deepEqual(agents.pullRequest.branches, ['main', 'release/*']);
  assert.ok(agents.pullRequest.paths.includes('packages/api/src/**'));
});

test('the planner selects exactly the lanes that apply to the governance diff', async () => {
  const workflows = await loadWorkflows(fileURLToPath(new URL('../workflows/', import.meta.url)));
  const changedFiles = [
    '.github/MAIN_BRANCH.md',
    '.github/pull_request_template.md',
    '.github/scripts/ci-gate.mjs',
    '.github/scripts/ci-gate.test.mjs',
    '.github/workflows/ci-gate.yml',
    '.github/workflows/cloudflare-production.yml',
    '.github/workflows/helmcharts.yml',
    '.github/workflows/locize-i18n-sync.yml',
    'AGENTS.md',
    'README.md',
    'client/src/lib/rum/redact.spec.ts',
    'deploy/oci/README.md',
    'deploy/selfhost/README.md',
    'docs/CI-UNBLOCK.md',
    'docs/deployment-acceptance.md',
    'docs/governance/ci-gate.md',
    'docs/governance/cross-repo-tracker.md',
    'packages/api/src/autobuild/verify.spec.ts',
    'packages/api/src/mcp/__tests__/mcp.spec.ts',
    'packages/security-lab-core/test/core.test.js',
    'redis-config/redis-tls.conf',
    'redis-config/start-redis-tls.sh',
    'scripts/verify.mjs',
  ];
  const plan = planGate({ workflows, changedFiles, baseRef: 'main', action: 'synchronize' });

  assert.deepEqual(plan.errors, []);
  assert.equal(plan.expected.size, 13);
  for (const expected of [
    '.github/workflows/a11y.yml',
    '.github/workflows/agents-integration-tests.yml',
    '.github/workflows/backend-review.yml',
    '.github/workflows/cache-integration-tests.yml',
    '.github/workflows/codegraph-select.yml',
    '.github/workflows/coderax-oci-proxy.yml',
    '.github/workflows/coderax-selfhost.yml',
    '.github/workflows/docker-smoke.yml',
    '.github/workflows/frontend-review.yml',
    '.github/workflows/lighthouse.yml',
    '.github/workflows/playwright-bombadil.yml',
    '.github/workflows/playwright-mock.yml',
    '.github/workflows/static-checks.yml',
  ]) {
    assert.equal(plan.expected.has(expected), true, expected);
  }
  assert.equal(plan.expected.has(SELF_PATH), false);
  assert.equal(plan.expected.has('.github/workflows/workspace-acceptance.yml'), false);
  assert.equal(plan.expected.has('.github/workflows/copilot-code-review.yml'), false);
});

test('markdown-only changes do not trigger source-filtered lanes', async () => {
  const workflows = await loadWorkflows(fileURLToPath(new URL('../workflows/', import.meta.url)));
  const plan = planGate({
    workflows,
    changedFiles: ['client/src/readme.md'],
    baseRef: 'main',
    action: 'synchronize',
  });
  assert.equal(plan.expected.has('.github/workflows/a11y.yml'), false);
});

test('a docs-only diff triggers only the unfiltered observe workflow', async () => {
  const workflows = await loadWorkflows(fileURLToPath(new URL('../workflows/', import.meta.url)));
  const plan = planGate({
    workflows,
    changedFiles: ['docs/governance/cross-repo-tracker.md', 'README.md'],
    baseRef: 'main',
    action: 'synchronize',
  });
  assert.equal(plan.expected.size, 1);
  assert.equal(plan.expected.has('.github/workflows/codegraph-select.yml'), true);
  assert.deepEqual(plan.errors, []);
});

test('branch filters exclude a pull request that does not target main', async () => {
  const workflows = [
    workflow('.github/workflows/alpha.yml', {
      pullRequest: {
        paths: null,
        pathsIgnore: null,
        branches: ['main', 'release/*'],
        branchesIgnore: null,
        types: null,
      },
    }),
  ];
  const main = planGate({
    workflows,
    changedFiles: ['src/a.ts'],
    baseRef: 'main',
    action: 'synchronize',
  });
  assert.equal(main.expected.size, 1);
  const dev = planGate({
    workflows,
    changedFiles: ['src/a.ts'],
    baseRef: 'dev',
    action: 'synchronize',
  });
  assert.equal(dev.expected.size, 0);
  assert.equal(dev.filteredOut[0].reason, 'branches');
});

test('a workflow that started is evaluated even when its filter says otherwise', () => {
  const path = '.github/workflows/alpha.yml';
  const workflowDefinition = workflow(path, { pullRequest: { paths: ['docs/**'] } });
  const input = {
    workflows: [workflowDefinition],
    changedFiles: ['src/a.ts'],
    baseRef: 'main',
    action: 'synchronize',
  };
  assert.equal(planGate(input).expected.has(path), false);
  const plan = planGate({ ...input, observedRuns: [run({ path })] });
  assert.equal(plan.expected.size, 1);
  assert.equal(plan.expected.get(path).observed, true);
});

test('a workflow added by the pull request cannot become a required lane', () => {
  const workflows = [workflow('.github/workflows/alpha.yml')];
  const plan = planGate({
    workflows,
    changedFiles: ['src/a.ts'],
    baseRef: 'main',
    action: 'synchronize',
    observedRuns: [run({ path: '.github/workflows/new.yml' })],
  });
  assert.equal(plan.expected.has('.github/workflows/new.yml'), false);
  assert.equal(plan.expected.has('.github/workflows/alpha.yml'), true);
});

test('the gate excludes itself even when a run exists', () => {
  const workflows = [workflow(SELF_PATH), workflow('.github/workflows/alpha.yml')];
  const plan = planGate({
    workflows,
    changedFiles: ['src/a.ts'],
    baseRef: 'main',
    action: 'synchronize',
    observedRuns: [run({ path: SELF_PATH })],
  });
  assert.equal(plan.expected.has(SELF_PATH), false);
});

test('an activity type the workflow excludes is not required unless it ran', () => {
  const workflows = [
    workflow('.github/workflows/alpha.yml', {
      pullRequest: {
        paths: null,
        pathsIgnore: null,
        branches: null,
        branchesIgnore: null,
        types: ['opened'],
      },
    }),
  ];
  const plan = planGate({
    workflows,
    changedFiles: ['src/a.ts'],
    baseRef: 'main',
    action: 'synchronize',
  });
  assert.equal(plan.expected.get('.github/workflows/alpha.yml').requiredForMissing, false);
  assert.equal(plan.actionExcluded.length, 1);
});

test('the newest run wins, then its highest attempt, at the exact head', () => {
  const runs = [
    run({ id: 1, run_attempt: 3, conclusion: 'success' }),
    run({ id: 2, run_attempt: 1, conclusion: 'success' }),
    run({ id: 2, run_attempt: 2, conclusion: 'cancelled' }),
    run({ id: 3, head_sha: 'old-sha', conclusion: 'success' }),
    run({ id: 4, event: 'workflow_dispatch', conclusion: 'success' }),
    run({ id: 5, pull_requests: [{ number: 99 }], conclusion: 'success' }),
  ];
  const selected = selectRun(runs, '.github/workflows/alpha.yml', {
    headSha: 'head-sha',
    event: 'pull_request',
    repository: 'owner/repo',
    pullNumber: 1,
  });
  assert.equal(selected.id, 2);
  assert.equal(selected.run_attempt, 2);
  assert.equal(selected.conclusion, 'cancelled');
});

test('a slow first complete snapshot starts the settle window for runs and statuses', () => {
  for (const checks of [
    {},
    { expected: new Map(), runs: [], statuses: [{ context: 'legacy/ci', state: 'success' }] },
  ]) {
    const first = evaluate({ ...checks, now: 1_000_000 });
    assert.equal(first.decision, 'wait');
    assert.equal(first.lastChangeAt, 1_000_000);
    const settled = evaluate({
      ...checks,
      now: 1_030_000,
      startedAt: 970_000,
      lastChangeAt: first.lastChangeAt,
      previousSignature: first.signature,
    });
    assert.equal(settled.decision, 'pass');
  }
});

test('every non-success conclusion fails, including skipped and neutral', () => {
  for (const conclusion of [
    'failure',
    'cancelled',
    'timed_out',
    'action_required',
    'startup_failure',
    'stale',
    'neutral',
    'skipped',
    null,
  ]) {
    const result = evaluate({ runs: [run({ conclusion })] });
    assert.equal(result.decision, 'fail', String(conclusion));
    assert.match(result.reason, /Failed component workflows/);
  }
});

test('a running lane keeps the gate waiting, then passes', () => {
  const pending = evaluate({ runs: [run({ status: 'in_progress', conclusion: null })] });
  assert.equal(pending.decision, 'wait');
  assert.match(pending.reason, /Waiting on component workflows/);
  const done = evaluate({ previousSignature: pending.signature });
  assert.equal(done.decision, 'wait');
  assert.equal(evaluate({ previousSignature: done.signature }).decision, 'pass');
});

test('a required workflow that never registers fails after the start grace', () => {
  const early = evaluate({
    runs: [],
    startedAt: 1_000_000,
    lastChangeAt: 1_000_000,
    firstMissingAt: new Map(),
  });
  assert.equal(early.decision, 'wait');
  assert.match(early.reason, /Waiting for required workflows/);

  const expired = evaluate({
    runs: [],
    startedAt: 900_000,
    lastChangeAt: 900_000,
    firstMissingAt: new Map([['.github/workflows/alpha.yml', 900_000]]),
  });
  assert.equal(expired.decision, 'fail');
  assert.match(expired.reason, /never reported/);
});

test('a missing workflow that appears late resets the settle window', () => {
  const first = evaluate({
    runs: [],
    now: 1_000_000,
    startedAt: 1_000_000 - config.startGraceSeconds * 1000,
    lastChangeAt: 1_000_000,
    firstMissingAt: new Map([['.github/workflows/alpha.yml', 1_000_000 - 1_000]]),
  });
  assert.equal(first.decision, 'wait');
  const late = evaluate({
    now: 1_000_000,
    startedAt: 1_000_000 - config.startGraceSeconds * 1000,
    lastChangeAt: 1_000_000,
    firstMissingAt: first.firstMissingAt,
    previousSignature: first.signature,
    runs: [run({ status: 'in_progress', conclusion: null })],
  });
  assert.equal(late.decision, 'wait');
  assert.equal(late.lastChangeAt, 1_000_000);
});

test('the gate fails rather than hanging at the deadline', () => {
  const result = evaluate({
    runs: [run({ status: 'in_progress', conclusion: null })],
    now: 2_000_000,
    startedAt: 1_000_000,
    lastChangeAt: 1_000_000,
  });
  assert.equal(result.decision, 'fail');
  assert.match(result.reason, /Timed out/);
});

test('an empty expected set passes after a registration window', () => {
  const early = evaluate({ expected: new Map(), runs: [], now: 1_000_000, startedAt: 999_990 });
  assert.equal(early.decision, 'wait');
  const settled = evaluate({ expected: new Map(), runs: [] });
  assert.equal(settled.decision, 'pass');
  assert.match(settled.reason, /No component workflow matched/);
});

test('commit statuses are evaluated alongside workflow runs', () => {
  const failed = evaluate({ statuses: [{ context: 'legacy/ci', state: 'failure' }] });
  assert.equal(failed.decision, 'fail');
  const pending = evaluate({ statuses: [{ context: 'legacy/ci', state: 'pending' }] });
  assert.equal(pending.decision, 'wait');
  const passed = evaluate({ statuses: [{ context: 'legacy/ci', state: 'success' }] });
  assert.equal(passed.decision, 'wait');
});

test('runGate discards failed observations and fails at the deadline', async () => {
  let clock = 0;
  const result = await runGate({
    observe: async () => {
      throw new Error('503 from the API');
    },
    config: { ...config, timeoutSeconds: 1 },
    now: () => {
      clock += 400;
      return clock;
    },
    sleep: async () => {},
  });
  assert.equal(result.decision, 'fail');
  assert.match(result.reason, /Timed out without a complete snapshot/);
});

test('runGate recovers from a transient observation failure', async () => {
  let clock = 0;
  let attempts = 0;
  const result = await runGate({
    observe: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('transient');
      }
      return {
        expected: expectedOf(['.github/workflows/alpha.yml']),
        runs: [run()],
        statuses: [],
        headSha: 'head-sha',
        event: 'pull_request',
        repository: 'owner/repo',
        pullNumber: 1,
      };
    },
    config: { ...config, settleSeconds: 0 },
    now: () => {
      clock += 100;
      return clock;
    },
    sleep: async () => {},
  });
  assert.equal(result.decision, 'pass');
  assert.equal(attempts, 2);
});

test('a transient read failure restarts settling even when the next snapshot is unchanged', async () => {
  let clock = 0;
  const observedAt = [];
  const result = await runGate({
    observe: async () => {
      observedAt.push(clock);
      if (observedAt.length === 2) {
        throw new Error('transient');
      }
      return {
        expected: expectedOf(['.github/workflows/alpha.yml']),
        runs: [run()],
        headSha: 'head-sha',
      };
    },
    config: { ...config, settleSeconds: 2 },
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
  });
  assert.equal(result.decision, 'pass');
  assert.deepEqual(observedAt, [0, 1000, 2000, 3000]);
});

test('code owners are parsed, teams are ignored', () => {
  const owners = parseCodeOwners(
    ['# comment', '* @owner @org/team', '.github/ @maintainer', ''].join('\n'),
  );
  assert.deepEqual([...owners].sort(), ['maintainer', 'owner']);
});

test('latestReviews keeps only the newest decisive review per user', () => {
  const reviews = [
    { user: { login: 'a' }, state: 'APPROVED', submitted_at: '2026-01-01T00:00:00Z' },
    { user: { login: 'a' }, state: 'CHANGES_REQUESTED', submitted_at: '2026-01-02T00:00:00Z' },
    { user: { login: 'b' }, state: 'APPROVED', submitted_at: '2026-01-01T00:00:00Z' },
    { user: { login: 'b' }, state: 'COMMENTED', submitted_at: '2026-01-03T00:00:00Z' },
  ];
  const latest = latestReviews(reviews);
  assert.equal(latest.length, 2);
  assert.equal(latest.find((entry) => entry.user.login === 'a').state, 'CHANGES_REQUESTED');
  assert.equal(latest.find((entry) => entry.user.login === 'b').state, 'APPROVED');
});

test('the CI control guard allows owners and requires an owner approval for contributors', () => {
  const owners = new Set(['owner']);
  const changedFiles = ['.github/scripts/ci-gate.mjs'];
  const trusted = evaluateGateChangeGuard({
    changedFiles,
    authorAssociation: 'OWNER',
    author: 'owner',
    reviews: [],
    owners,
    headSha: 'head-sha',
  });
  assert.equal(trusted.ok, true);
  assert.equal(trusted.trustedAuthor, true);

  const codeOwner = evaluateGateChangeGuard({
    changedFiles,
    authorAssociation: 'COLLABORATOR',
    author: 'owner',
    reviews: [],
    owners,
    headSha: 'head-sha',
  });
  assert.equal(codeOwner.ok, true);
  assert.equal(codeOwner.codeOwner, true);

  const noApproval = evaluateGateChangeGuard({
    changedFiles,
    authorAssociation: 'CONTRIBUTOR',
    author: 'contributor',
    reviews: [],
    owners,
    headSha: 'head-sha',
  });
  assert.equal(noApproval.ok, false);

  const approved = evaluateGateChangeGuard({
    changedFiles,
    authorAssociation: 'CONTRIBUTOR',
    author: 'contributor',
    reviews: [
      {
        user: { login: 'owner' },
        state: 'APPROVED',
        commit_id: 'head-sha',
        submitted_at: '2026-01-01T00:00:00Z',
      },
    ],
    owners,
    headSha: 'head-sha',
  });
  assert.equal(approved.ok, true);

  const stale = evaluateGateChangeGuard({
    changedFiles,
    authorAssociation: 'CONTRIBUTOR',
    author: 'contributor',
    reviews: [
      {
        user: { login: 'owner' },
        state: 'APPROVED',
        commit_id: 'older-sha',
        submitted_at: '2026-01-01T00:00:00Z',
      },
    ],
    owners,
    headSha: 'head-sha',
  });
  assert.equal(stale.ok, false);

  const nonOwner = evaluateGateChangeGuard({
    changedFiles,
    authorAssociation: 'CONTRIBUTOR',
    author: 'contributor',
    reviews: [
      {
        user: { login: 'someone' },
        state: 'APPROVED',
        commit_id: 'head-sha',
        submitted_at: '2026-01-01T00:00:00Z',
      },
    ],
    owners,
    headSha: 'head-sha',
  });
  assert.equal(nonOwner.ok, false);
});

test('the guard does not apply when only ordinary source files change', () => {
  const guard = evaluateGateChangeGuard({
    changedFiles: ['client/src/a.ts'],
    authorAssociation: 'CONTRIBUTOR',
    author: 'contributor',
    reviews: [],
    owners: new Set(['owner']),
    headSha: 'head-sha',
  });
  assert.equal(guard.required, false);
  assert.equal(guard.ok, true);
  assert.ok(GATE_CONTROL_PATHS.includes('.github/workflows/'));
});

test('bootstrap is owner-only, disappears when the base has the gate, and is reported', () => {
  const bootstrap = evaluateBootstrap({
    baseGatePresent: false,
    authorAssociation: 'OWNER',
    trusted: false,
  });
  assert.equal(bootstrap.ok, true);
  assert.equal(bootstrap.bootstrap, true);

  const codeOwner = evaluateBootstrap({
    baseGatePresent: false,
    authorAssociation: 'COLLABORATOR',
    trusted: false,
    bootstrapAuthorized: true,
  });
  assert.equal(codeOwner.ok, true);
  assert.equal(codeOwner.bootstrap, true);

  const contributor = evaluateBootstrap({
    baseGatePresent: false,
    authorAssociation: 'COLLABORATOR',
    trusted: false,
    bootstrapAuthorized: false,
  });
  assert.equal(contributor.ok, false);

  const notOverridable = evaluateBootstrap({
    baseGatePresent: true,
    authorAssociation: 'COLLABORATOR',
    trusted: false,
    bootstrapAuthorized: true,
  });
  assert.equal(notOverridable.ok, false);

  const permanent = evaluateBootstrap({
    baseGatePresent: true,
    authorAssociation: 'OWNER',
    trusted: false,
  });
  assert.equal(permanent.ok, false);

  const trusted = evaluateBootstrap({
    baseGatePresent: true,
    authorAssociation: 'OWNER',
    trusted: true,
  });
  assert.equal(trusted.ok, true);
  assert.equal(trusted.bootstrap, false);
});

test('merge_group is supported only when every component declares it', () => {
  const supported = mergeGroupSupport({
    workflows: [
      workflow(SELF_PATH, { mergeGroup: true }),
      workflow('.github/workflows/alpha.yml', { mergeGroup: true }),
      workflow('.github/workflows/beta.yml', { mergeGroup: true }),
    ],
  });
  assert.equal(supported.supported, true);

  const unsupported = mergeGroupSupport({
    workflows: [
      workflow(SELF_PATH, { mergeGroup: true }),
      workflow('.github/workflows/alpha.yml', { mergeGroup: true }),
      workflow('.github/workflows/beta.yml', { mergeGroup: false }),
    ],
  });
  assert.equal(unsupported.supported, false);
  assert.deepEqual(unsupported.missing, [
    { name: '.github/workflows/beta.yml', path: '.github/workflows/beta.yml' },
  ]);

  const empty = mergeGroupSupport({ workflows: [workflow(SELF_PATH, { mergeGroup: true })] });
  assert.equal(empty.supported, false);
});

test('verifyInstallation requires the exact required job name', () => {
  const gate = parseWorkflow(
    'name: CI gate\non:\n  pull_request:\n  merge_group:\njobs:\n  aggregate:\n    name: CI gate\n    runs-on: ubuntu-latest\n',
    SELF_PATH,
  );
  const component = parseWorkflow(
    'name: Alpha\non:\n  pull_request:\n',
    '.github/workflows/alpha.yml',
  );
  const result = verifyInstallation({ workflows: [gate, component] });
  assert.equal(result.ok, false);
  assert.match(result.problems.join(' '), /required job name/);
});

test('verifyInstallation catches a path-filtered or merge_group-less gate', () => {
  const good = verifyInstallation({
    workflows: [workflow(SELF_PATH, { mergeGroup: true }), workflow('.github/workflows/alpha.yml')],
  });
  assert.equal(good.ok, true);

  const filtered = verifyInstallation({
    workflows: [
      workflow(SELF_PATH, {
        mergeGroup: true,
        pullRequest: {
          paths: ['**'],
          pathsIgnore: null,
          branches: null,
          branchesIgnore: null,
          types: null,
        },
      }),
      workflow('.github/workflows/alpha.yml'),
    ],
  });
  assert.equal(filtered.ok, false);

  const noMergeGroup = verifyInstallation({
    workflows: [
      workflow(SELF_PATH, { mergeGroup: false }),
      workflow('.github/workflows/alpha.yml'),
    ],
  });
  assert.equal(noMergeGroup.ok, false);
});

const scriptPath = fileURLToPath(new URL('./ci-gate.mjs', import.meta.url));

async function fixture({ mergeGroup = false, owner = '@owner' } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'ci-gate-'));
  const workflows = path.join(directory, 'workflows');
  await import('node:fs/promises').then(({ mkdir }) => mkdir(workflows, { recursive: true }));
  const mergeLine = mergeGroup ? '  merge_group:\n' : '';
  await writeFile(
    path.join(workflows, 'ci-gate.yml'),
    `name: CI gate\non:\n  pull_request:\n    branches: [main]\n${mergeLine}jobs:\n  aggregate:\n    name: CI gate (aggregate)\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo gate\n`,
  );
  await writeFile(
    path.join(workflows, 'alpha.yml'),
    `name: Alpha\non:\n  pull_request:\n    branches: [main]\n${mergeLine ? '  merge_group:\n' : ''}`,
  );
  await writeFile(
    path.join(workflows, 'beta.yml'),
    `name: Beta\non:\n  pull_request:\n    paths:\n      - 'src/**'\n${
      mergeGroup ? '  merge_group:\n' : ''
    }`,
  );
  await writeFile(path.join(directory, 'CODEOWNERS'), `* ${owner}\n`);
  return {
    directory,
    workflows,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

function responseJson(value, headers = {}) {
  return Response.json(value, { headers });
}

function spawnGate(fixtureInfo, mockFetch, env = {}) {
  const script = scriptPath;
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      `data:text/javascript,${encodeURIComponent(`globalThis.fetch = (${mockFetch});`)}`,
      script,
    ],
    {
      encoding: 'utf8',
      timeout: 8_000,
      env: {
        ...process.env,
        GH_TOKEN: 'test-token',
        GITHUB_REPOSITORY: 'owner/repo',
        GATE_EVENT: 'pull_request',
        PR_NUMBER: '1',
        PR_ACTION: 'synchronize',
        PR_AUTHOR: 'owner',
        PR_AUTHOR_ASSOCIATION: 'OWNER',
        HEAD_SHA: 'head-sha',
        BASE_SHA: 'base-sha',
        BASE_REF: 'main',
        GATE_MODE: 'aggregate',
        GATE_TRUSTED: 'true',
        BASE_GATE_PRESENT: 'true',
        WORKFLOWS_DIR: fixtureInfo.workflows,
        GATE_CODEOWNERS: path.join(fixtureInfo.directory, 'CODEOWNERS'),
        GATE_POLL_SECONDS: '1',
        GATE_TIMEOUT_SECONDS: '4',
        GATE_START_GRACE_SECONDS: '0.2',
        GATE_SETTLE_SECONDS: '0.1',
        GATE_EMPTY_SETTLE_SECONDS: '0.1',
        GATE_RETRY_BASE_MS: '1',
        ...env,
      },
    },
  );
  assert.ifError(result.error);
  return result;
}

function standardFetch({ runs = 'success', statuses = 'empty', runsPages } = {}) {
  return `(async (url) => {
    const { pathname, searchParams } = new URL(url);
    if (pathname.endsWith('/pulls/1/files')) {
      return Response.json([{ filename: 'src/a.ts' }]);
    }
    if (pathname.endsWith('/pulls/1/reviews')) {
      return Response.json([]);
    }
    if (pathname.includes('/actions/runs')) {
      ${
        runsPages ??
        `return Response.json({ total_count: 2, workflow_runs: [
          { id: 1, name: 'Alpha', path: '.github/workflows/alpha.yml', event: 'pull_request', head_sha: 'head-sha', status: 'completed', conclusion: '${runs}', run_attempt: 1, repository: { full_name: 'owner/repo' }, pull_requests: [{ number: 1 }] },
          { id: 2, name: 'Beta', path: '.github/workflows/beta.yml', event: 'pull_request', head_sha: 'head-sha', status: 'completed', conclusion: '${runs}', run_attempt: 1, repository: { full_name: 'owner/repo' }, pull_requests: [{ number: 1 }] }
        ] });`
      }
    }
    if (pathname.includes('/status')) {
      if ('${statuses}' === 'failure') {
        return Response.json({ sha: 'head-sha', statuses: [{ context: 'legacy', state: 'failure' }] });
      }
      if ('${statuses}' === 'pending') {
        return Response.json({ sha: 'head-sha', statuses: [{ context: 'legacy', state: 'pending' }] });
      }
      return Response.json({ sha: 'head-sha', statuses: [] });
    }
    throw new Error('unexpected URL ' + url);
  })`;
}

test('hosted-gate harness: a clean head passes', async () => {
  const fixtureInfo = await fixture();
  try {
    const result = spawnGate(fixtureInfo, standardFetch());
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /All 2 applicable component workflow/);
  } finally {
    await fixtureInfo.cleanup();
  }
});

test('hosted-gate harness: a failing component fails the gate', async () => {
  const fixtureInfo = await fixture();
  try {
    const result = spawnGate(fixtureInfo, standardFetch({ runs: 'failure' }));
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /Failed component workflows/);
  } finally {
    await fixtureInfo.cleanup();
  }
});

test('hosted-gate harness: a skipped component fails the gate', async () => {
  const fixtureInfo = await fixture();
  try {
    const result = spawnGate(fixtureInfo, standardFetch({ runs: 'skipped' }));
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /Failed component workflows/);
  } finally {
    await fixtureInfo.cleanup();
  }
});

test('hosted-gate harness: a status failure on page two fails the gate', async () => {
  const fixtureInfo = await fixture();
  try {
    const mock = `(async (url) => {
      const { pathname, searchParams } = new URL(url);
      if (pathname.endsWith('/pulls/1/files')) return Response.json([{ filename: 'src/a.ts' }]);
      if (pathname.endsWith('/pulls/1/reviews')) return Response.json([]);
      if (pathname.includes('/actions/runs')) {
        return Response.json({ total_count: 2, workflow_runs: [
          { id: 1, path: '.github/workflows/alpha.yml', event: 'pull_request', head_sha: 'head-sha', status: 'completed', conclusion: 'success', run_attempt: 1, repository: { full_name: 'owner/repo' }, pull_requests: [{ number: 1 }] },
          { id: 2, path: '.github/workflows/beta.yml', event: 'pull_request', head_sha: 'head-sha', status: 'completed', conclusion: 'success', run_attempt: 1, repository: { full_name: 'owner/repo' }, pull_requests: [{ number: 1 }] }
        ] });
      }
      if (pathname.includes('/status')) {
        if (searchParams.get('page') === '2') {
          return Response.json({ sha: 'head-sha', statuses: [{ context: 'legacy', state: 'failure' }] });
        }
        return Response.json({ sha: 'head-sha', statuses: [] }, { headers: { link: '<https://api.github.com/repos/owner/repo/commits/head-sha/status?per_page=100&page=2>; rel="next"' } });
      }
      throw new Error('unexpected URL ' + url);
    })`;
    const result = spawnGate(fixtureInfo, mock);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /Failed commit statuses/);
  } finally {
    await fixtureInfo.cleanup();
  }
});

test('hosted-gate harness: an API failure never becomes an empty passing snapshot', async () => {
  const fixtureInfo = await fixture();
  try {
    const mock = `(async (url) => {
      const { pathname } = new URL(url);
      if (pathname.endsWith('/pulls/1/files')) return Response.json([{ filename: 'src/a.ts' }]);
      if (pathname.endsWith('/pulls/1/reviews')) return Response.json([]);
      if (pathname.includes('/status')) return new Response(null, { status: 503 });
      return Response.json({ total_count: 0, workflow_runs: [] });
    })`;
    const result = spawnGate(fixtureInfo, mock, { GATE_TIMEOUT_SECONDS: '0.4' });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /Timed out without a complete snapshot/);
  } finally {
    await fixtureInfo.cleanup();
  }
});

test('hosted-gate harness: the deadline also bounds the initial changed-file read', async () => {
  const fixtureInfo = await fixture();
  try {
    const mock = `(async (url, { signal }) => {
      if (!new URL(url).pathname.endsWith('/pulls/1/files')) throw new Error('unexpected URL');
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => {
        reject(signal.reason);
      }, { once: true }));
    })`;
    const result = spawnGate(fixtureInfo, mock, { GATE_TIMEOUT_SECONDS: '0.2' });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Gate deadline reached/);
  } finally {
    await fixtureInfo.cleanup();
  }
});

test('hosted-gate harness: the deadline aborts a hung second page and interrupts retry backoff', async () => {
  const fixtureInfo = await fixture();
  try {
    const mock = `(async (url, { signal }) => {
      const { pathname, searchParams } = new URL(url);
      if (pathname.endsWith('/pulls/1/files')) return Response.json([{ filename: 'src/a.ts' }]);
      if (pathname.includes('/actions/runs')) return new Response(null, { status: 503 });
      if (!searchParams.has('page')) {
        return Response.json({ sha: 'head-sha', statuses: [] }, {
          headers: { link: '<https://api.github.com/repos/owner/repo/commits/head-sha/status?page=2>; rel="next"' }
        });
      }
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => {
        console.log('Second page aborted');
        reject(signal.reason);
      }, { once: true }));
    })`;
    const result = spawnGate(fixtureInfo, mock, {
      GATE_TIMEOUT_SECONDS: '0.2',
      GATE_RETRY_BASE_MS: '60000',
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /Second page aborted/);
    assert.match(result.stdout, /Timed out without a complete snapshot/);
  } finally {
    await fixtureInfo.cleanup();
  }
});

test('runGate does not poll again when a poll sleep reaches the deadline', async () => {
  let clock = 0;
  let attempts = 0;
  const result = await runGate({
    observe: async () => {
      attempts += 1;
      return { expected: new Map() };
    },
    config: { ...config, timeoutSeconds: 0.1, pollSeconds: 30 },
    now: () => clock,
    sleep: async (milliseconds) => {
      assert.equal(milliseconds, 100);
      clock += milliseconds;
    },
  });
  assert.equal(attempts, 1);
  assert.equal(result.decision, 'fail');
  assert.match(result.reason, /Timed out/);
});

test('hosted-gate harness: a transient API failure can recover', async () => {
  const fixtureInfo = await fixture();
  try {
    const mock = `(async (url) => {
      const { pathname } = new URL(url);
      if (pathname.endsWith('/pulls/1/files')) return Response.json([{ filename: 'src/a.ts' }]);
      if (pathname.endsWith('/pulls/1/reviews')) return Response.json([]);
      if (pathname.includes('/status')) {
        if (!globalThis.failedOnce) {
          globalThis.failedOnce = true;
          return new Response(null, { status: 503 });
        }
        return Response.json({ sha: 'head-sha', statuses: [] });
      }
      return Response.json({ total_count: 2, workflow_runs: [
        { id: 1, path: '.github/workflows/alpha.yml', event: 'pull_request', head_sha: 'head-sha', status: 'completed', conclusion: 'success', run_attempt: 1, repository: { full_name: 'owner/repo' }, pull_requests: [{ number: 1 }] },
        { id: 2, path: '.github/workflows/beta.yml', event: 'pull_request', head_sha: 'head-sha', status: 'completed', conclusion: 'success', run_attempt: 1, repository: { full_name: 'owner/repo' }, pull_requests: [{ number: 1 }] }
      ] });
    })`;
    const result = spawnGate(fixtureInfo, mock);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    await fixtureInfo.cleanup();
  }
});

test('hosted-gate harness: a stale run at another SHA cannot satisfy the gate', async () => {
  const fixtureInfo = await fixture();
  try {
    const mock = `(async (url) => {
      const { pathname } = new URL(url);
      if (pathname.endsWith('/pulls/1/files')) return Response.json([{ filename: 'src/a.ts' }]);
      if (pathname.endsWith('/pulls/1/reviews')) return Response.json([]);
      if (pathname.includes('/status')) return Response.json({ sha: 'head-sha', statuses: [] });
      return Response.json({ total_count: 2, workflow_runs: [
        { id: 1, path: '.github/workflows/alpha.yml', event: 'pull_request', head_sha: 'other-sha', status: 'completed', conclusion: 'success', run_attempt: 1, repository: { full_name: 'owner/repo' }, pull_requests: [{ number: 1 }] },
        { id: 2, path: '.github/workflows/beta.yml', event: 'pull_request', head_sha: 'other-sha', status: 'completed', conclusion: 'success', run_attempt: 1, repository: { full_name: 'owner/repo' }, pull_requests: [{ number: 1 }] }
      ] });
    })`;
    const result = spawnGate(fixtureInfo, mock);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /never reported/);
  } finally {
    await fixtureInfo.cleanup();
  }
});

test('hosted-gate harness: workflow runs on page two are counted', async () => {
  const fixtureInfo = await fixture();
  try {
    const mock = `(async (url) => {
      const { pathname, searchParams } = new URL(url);
      if (pathname.endsWith('/pulls/1/files')) return Response.json([{ filename: 'src/a.ts' }]);
      if (pathname.endsWith('/pulls/1/reviews')) return Response.json([]);
      if (pathname.includes('/status')) return Response.json({ sha: 'head-sha', statuses: [] });
      if (pathname.includes('/actions/runs')) {
        if (searchParams.get('page') === '2') {
          return Response.json({ total_count: 2, workflow_runs: [
            { id: 2, path: '.github/workflows/beta.yml', event: 'pull_request', head_sha: 'head-sha', status: 'completed', conclusion: 'success', run_attempt: 1, repository: { full_name: 'owner/repo' }, pull_requests: [{ number: 1 }] }
          ] });
        }
        return Response.json({ total_count: 2, workflow_runs: [
          { id: 1, path: '.github/workflows/alpha.yml', event: 'pull_request', head_sha: 'head-sha', status: 'completed', conclusion: 'success', run_attempt: 1, repository: { full_name: 'owner/repo' }, pull_requests: [{ number: 1 }] }
        ] }, { headers: { link: '<https://api.github.com/repos/owner/repo/actions/runs?head_sha=head-sha&per_page=100&page=2>; rel="next"' } });
      }
      throw new Error('unexpected URL ' + url);
    })`;
    const result = spawnGate(fixtureInfo, mock);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /All 2 applicable component workflow/);
  } finally {
    await fixtureInfo.cleanup();
  }
});

test('merge group planning uses its own branch filters and requires unregistered lanes', () => {
  const alpha = parseWorkflow(
    'on:\n  pull_request:\n    paths: [src/**]\n  merge_group:\n    branches: [main]\n    types: [checks_requested]\n',
    '.github/workflows/alpha.yml',
  );
  const beta = parseWorkflow(
    'on:\n  pull_request:\n    branches: [main]\n  merge_group:\n    branches-ignore: [main]\n',
    '.github/workflows/beta.yml',
  );
  const plan = planGate({
    workflows: [alpha, beta],
    changedFiles: ['docs/a.md'],
    baseRef: 'main',
    action: 'merge_group',
  });
  assert.equal(plan.expected.get(alpha.path).requiredForMissing, true);
  assert.equal(plan.expected.has(beta.path), false);
});

test('hosted-gate harness: merge_group verifies the candidate when every component supports it', async () => {
  const fixtureInfo = await fixture({ mergeGroup: true });
  try {
    const mock = `(async (url) => {
      const { pathname } = new URL(url);
      if (pathname.includes('/compare/')) return Response.json({ files: [{ filename: 'docs/a.md' }] });
      if (pathname.includes('/actions/runs')) return Response.json({ total_count: 2, workflow_runs: [
        { id: 1, path: '.github/workflows/alpha.yml', event: 'merge_group', head_sha: 'head-sha', status: 'completed', conclusion: 'success', run_attempt: 1, repository: { full_name: 'owner/repo' } },
        { id: 2, path: '.github/workflows/beta.yml', event: 'merge_group', head_sha: 'head-sha', status: 'completed', conclusion: 'success', run_attempt: 1, repository: { full_name: 'owner/repo' } }
      ] });
      if (pathname.includes('/status')) return Response.json({ sha: 'head-sha', statuses: [] });
      throw new Error('unexpected URL ' + url);
    })`;
    const result = spawnGate(fixtureInfo, mock, {
      GATE_EVENT: 'merge_group',
      BASE_REF: 'refs/heads/main',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /All 2 applicable component workflow/);
  } finally {
    await fixtureInfo.cleanup();
  }
});

test('hosted-gate harness: merge_group without component support fails closed', async () => {
  const fixtureInfo = await fixture({ mergeGroup: false });
  try {
    const result = spawnGate(fixtureInfo, standardFetch(), { GATE_EVENT: 'merge_group' });
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stdout + result.stderr, /Merge queue is not supported/);
  } finally {
    await fixtureInfo.cleanup();
  }
});

test('hosted-gate harness: a base code owner can bootstrap the gate', async () => {
  const fixtureInfo = await fixture();
  try {
    const result = spawnGate(fixtureInfo, standardFetch(), {
      BASE_GATE_PRESENT: 'false',
      GATE_TRUSTED: 'false',
      GATE_BOOTSTRAP_AUTHORIZED: 'true',
      PR_AUTHOR_ASSOCIATION: 'COLLABORATOR',
      PR_AUTHOR: 'owner',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Bootstrap run/);
  } finally {
    await fixtureInfo.cleanup();
  }
});

test('hosted-gate harness: a contributor cannot bootstrap the gate', async () => {
  const fixtureInfo = await fixture();
  try {
    const result = spawnGate(fixtureInfo, standardFetch(), {
      BASE_GATE_PRESENT: 'false',
      GATE_TRUSTED: 'false',
      PR_AUTHOR_ASSOCIATION: 'CONTRIBUTOR',
      PR_AUTHOR: 'contributor',
    });
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(
      result.stdout + result.stderr,
      /Refusing to execute pull-request-owned gate logic/,
    );
  } finally {
    await fixtureInfo.cleanup();
  }
});

test('hosted-gate harness: verify mode proves the installed gate is usable', async () => {
  const fixtureInfo = await fixture({ mergeGroup: true });
  try {
    const result = spawnSync(process.execPath, [scriptPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GATE_MODE: 'verify',
        WORKFLOWS_DIR: fixtureInfo.workflows,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /installation/);
  } finally {
    await fixtureInfo.cleanup();
  }
});
