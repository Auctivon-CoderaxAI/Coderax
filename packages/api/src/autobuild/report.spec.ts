import type { BuildSnapshot, BuildStepSnapshot } from './report';
import { summarizeBuild } from './report';

const step = (overrides: Partial<BuildStepSnapshot> = {}): BuildStepSnapshot => ({
  id: 'implement',
  title: 'Implement the change',
  status: 'completed',
  attempts: 1,
  result: 'Ran the focused tests: 4 passed.',
  ...overrides,
});

const snapshot = (overrides: Partial<BuildSnapshot> = {}): BuildSnapshot => ({
  mode: 'autonomous',
  status: 'completed',
  steps: [step()],
  startedAt: '2026-01-01T00:00:00.000Z',
  settledAt: '2026-01-01T00:10:00.000Z',
  gates: [
    { gate: 'tests', status: 'passed' },
    { gate: 'build', status: 'passed' },
    { gate: 'review', status: 'passed' },
  ],
  pullRequest: { url: 'https://github.com/owner/repo/pull/1', state: 'open', checks: 'passed' },
  ...overrides,
});

describe('summarizeBuild', () => {
  it('reports a verified completion only with all gates, evidence and a reviewable pull request', () => {
    const report = summarizeBuild(snapshot());

    expect(report.outcome).toBe('verified_complete');
    expect(report.verified).toBe(true);
    expect(report.finished).toHaveLength(1);
    expect(report.blockers).toEqual([]);
    expect(report.turbo.met).toBeNull();
  });

  it('does not verify a completed run whose tests never ran', () => {
    const report = summarizeBuild(
      snapshot({
        gates: [
          { gate: 'tests', status: 'not_run' },
          { gate: 'build', status: 'passed' },
          { gate: 'review', status: 'passed' },
        ],
      }),
    );

    expect(report.outcome).toBe('complete_unverified');
    expect(report.verified).toBe(false);
    expect(report.missingGates).toEqual(['tests']);
    expect(report.blockers).toContain('Required gate tests did not pass');
  });

  it('treats a completed turn with no retained evidence as unverified', () => {
    const report = summarizeBuild(snapshot({ steps: [step({ result: '  ' })] }));

    expect(report.outcome).toBe('complete_unverified');
    expect(report.unverified.map((task) => task.id)).toEqual(['implement']);
    expect(report.blockers).toContain('Task implement has no retained evidence');
  });

  it('reports skipped work as partial rather than complete', () => {
    const report = summarizeBuild(
      snapshot({
        steps: [
          step(),
          step({ id: 'deploy', title: 'Deploy', status: 'skipped', reason: 'Not authorized' }),
        ],
      }),
    );

    expect(report.outcome).toBe('partial');
    expect(report.unfinished.map((task) => task.id)).toEqual(['deploy']);
  });

  it('reports a failed task as blocked and keeps a partial result', () => {
    const report = summarizeBuild(
      snapshot({ steps: [step(), step({ id: 'build', title: 'Build', status: 'failed' })] }),
    );

    expect(report.outcome).toBe('partial');
    expect(report.blocked.map((task) => task.id)).toEqual(['build']);
    expect(report.blockers).toContain('Task build failed');
  });

  it('reports a failed run with no finished task as failed', () => {
    const report = summarizeBuild(
      snapshot({ status: 'failed', steps: [step({ status: 'failed', result: undefined })] }),
    );

    expect(report.outcome).toBe('failed');
    expect(report.verified).toBe(false);
  });

  it('reports a cancelled run as blocked', () => {
    const report = summarizeBuild(snapshot({ status: 'cancelled' }));

    expect(report.outcome).toBe('blocked');
    expect(report.verified).toBe(false);
  });

  it('stays in progress while the run is not terminal', () => {
    const report = summarizeBuild(snapshot({ status: 'running', settledAt: undefined }));

    expect(report.outcome).toBe('in_progress');
    expect(report.turbo.met).toBeNull();
    // This mode has no deadline, so there is no turbo target to be on track for.
    expect(report.turbo.reason).toBe('no_deadline');
  });

  it('reports an in-progress turbo run against its deadline', () => {
    const report = summarizeBuild(
      snapshot({
        mode: 'turbo15',
        status: 'running',
        settledAt: undefined,
        deadlineAt: '2026-01-01T00:15:00.000Z',
      }),
    );

    expect(report.outcome).toBe('in_progress');
    expect(report.turbo.met).toBeNull();
    expect(report.turbo.reason).toBe('in_progress');
  });

  it('requires a security gate in verified mode', () => {
    const report = summarizeBuild(snapshot({ mode: 'verified' }));

    expect(report.missingGates).toEqual(['security']);
    expect(report.outcome).toBe('complete_unverified');
  });

  it('requires security when the plan has a security task', () => {
    const report = summarizeBuild(
      snapshot({
        steps: [
          step(),
          step({
            id: 'security',
            title: 'Review tenant boundaries',
            role: 'security',
            result: 'Reviewed the tenant checks.',
          }),
        ],
        gates: [
          { gate: 'tests', status: 'passed' },
          { gate: 'build', status: 'passed' },
          { gate: 'review', status: 'passed' },
          { gate: 'security', status: 'failed' },
        ],
      }),
    );

    expect(report.missingGates).toEqual(['security']);
    expect(report.outcome).toBe('complete_unverified');
    expect(report.verified).toBe(false);
  });

  it('honors required gates supplied for a specific plan', () => {
    const report = summarizeBuild(
      snapshot({ requiredGates: ['tests', 'build', 'review', 'security'] }),
    );

    expect(report.missingGates).toEqual(['security']);
    expect(report.outcome).toBe('complete_unverified');
  });

  it('blocks verification when a supplied gate failed even if it was not required', () => {
    const report = summarizeBuild(
      snapshot({
        gates: [
          { gate: 'tests', status: 'passed' },
          { gate: 'build', status: 'passed' },
          { gate: 'review', status: 'passed' },
          { gate: 'security', status: 'failed' },
        ],
      }),
    );

    expect(report.missingGates).toEqual([]);
    expect(report.outcome).toBe('complete_unverified');
    expect(report.blockers).toContain('Gate security failed');
  });

  it('requires a reviewable pull request when the policy does', () => {
    const report = summarizeBuild(snapshot({ pullRequest: null }));

    expect(report.outcome).toBe('complete_unverified');
    expect(report.delivery.ok).toBe(false);
    expect(report.blockers).toContain('No reviewable pull request exists');
  });

  it('rejects a pull request whose checks are still pending or failed', () => {
    const pending = summarizeBuild(
      snapshot({
        pullRequest: {
          url: 'https://github.com/owner/repo/pull/1',
          state: 'open',
          checks: 'pending',
        },
      }),
    );
    const failed = summarizeBuild(
      snapshot({
        pullRequest: {
          url: 'https://github.com/owner/repo/pull/1',
          state: 'open',
          checks: 'failed',
        },
      }),
    );

    expect(pending.outcome).toBe('complete_unverified');
    expect(failed.outcome).toBe('complete_unverified');
  });

  it('meets turbo only when a verified build settles inside the deadline', () => {
    const within = summarizeBuild(
      snapshot({
        mode: 'turbo15',
        deadlineAt: '2026-01-01T00:15:00.000Z',
        settledAt: '2026-01-01T00:12:00.000Z',
      }),
    );
    const after = summarizeBuild(
      snapshot({
        mode: 'turbo15',
        deadlineAt: '2026-01-01T00:15:00.000Z',
        settledAt: '2026-01-01T00:20:00.000Z',
      }),
    );

    expect(within.turbo.met).toBe(true);
    expect(within.turbo.reason).toBe('verified_within_budget');
    expect(within.turbo.elapsedMs).toBe(12 * 60_000);

    expect(after.turbo.met).toBe(false);
    expect(after.turbo.reason).toBe('verified_after_budget');
    expect(after.turbo.overrunMs).toBe(5 * 60_000);
  });

  it('does not let a later snapshot deadline relax the turbo budget', () => {
    const report = summarizeBuild(
      snapshot({
        mode: 'turbo15',
        deadlineAt: '2026-01-01T01:00:00.000Z',
        settledAt: '2026-01-01T00:20:00.000Z',
      }),
    );

    expect(report.turbo.met).toBe(false);
    expect(report.turbo.reason).toBe('verified_after_budget');
    expect(report.turbo.overrunMs).toBe(5 * 60_000);
  });

  it('does not count a fast but unverified build as a turbo success', () => {
    const report = summarizeBuild(
      snapshot({
        mode: 'turbo15',
        deadlineAt: '2026-01-01T00:15:00.000Z',
        gates: [
          { gate: 'tests', status: 'failed' },
          { gate: 'build', status: 'passed' },
          { gate: 'review', status: 'passed' },
        ],
      }),
    );

    expect(report.turbo.met).toBe(false);
    expect(report.turbo.reason).toBe('not_verified');
  });

  it('does not claim a turbo result without timing evidence', () => {
    const report = summarizeBuild(
      snapshot({
        mode: 'turbo15',
        deadlineAt: '2026-01-01T00:15:00.000Z',
        startedAt: undefined,
      }),
    );

    expect(report.turbo.met).toBe(false);
    expect(report.turbo.reason).toBe('missing_timing');
  });

  it('reports unfinished blockers separately from a failed gate', () => {
    const report = summarizeBuild(
      snapshot({
        steps: [step(), step({ id: 'review', title: 'Review', status: 'failed' })],
        gates: [{ gate: 'tests', status: 'not_run' }],
      }),
      { requiredGates: ['tests'], requirePullRequest: false },
    );

    expect(report.blocked.map((task) => task.id)).toEqual(['review']);
    expect(report.missingGates).toEqual(['tests']);
    expect(report.blockers).toEqual(
      expect.arrayContaining(['Task review failed', 'Required gate tests did not pass']),
    );
  });

  it('passes through a deployment result without treating it as verification', () => {
    const report = summarizeBuild(snapshot({ deployment: { status: 'not_attempted' } }));

    expect(report.verified).toBe(true);
    expect(report.deployment?.status).toBe('not_attempted');
  });
});
