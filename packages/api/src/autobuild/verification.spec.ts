import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import type { WorkflowBuildSettings } from 'coderax-data-provider';
import type { WorkflowRunRecord, WorkflowStepRecord } from '../workflows/types';
import type { CommandRunner } from './verify';
import { verifyBuildRun } from './verification';

const step = (overrides: Partial<WorkflowStepRecord> = {}): WorkflowStepRecord => ({
  id: 'implement',
  title: 'Implement',
  instruction: 'Implement it',
  approvalRequired: false,
  maxAttempts: 1,
  status: 'completed',
  attempts: 1,
  result: 'Changed three files and ran the focused tests.',
  ...overrides,
});

const build = (overrides: Partial<WorkflowBuildSettings> = {}): WorkflowBuildSettings => ({
  mode: 'autonomous',
  requiredGates: ['tests', 'review'],
  reviewStepId: 'review',
  requirePullRequest: false,
  repository: { owner: 'Auctivon-CoderaxAI', name: 'Coderax' },
  workspace: 'checkout',
  ...overrides,
});

const run = (overrides: Partial<WorkflowRunRecord> = {}): WorkflowRunRecord => ({
  id: 'run-1',
  userId: 'user-1',
  workflowId: 'wf-1',
  workflowName: 'Build',
  agentId: 'agent-1',
  status: 'running',
  currentStep: 2,
  steps: [],
  settings: { build: build() },
  startedAt: new Date('2026-01-01T00:00:00.000Z'),
  events: [],
  ...overrides,
});

const runner =
  (exitCode: number, output = ''): CommandRunner =>
  async () => ({
    exitCode,
    stdout: output,
    stderr: exitCode === 0 ? '' : 'one test failed',
    timedOut: false,
    cancelled: false,
    durationMs: 5,
  });

describe('verifyBuildRun', () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'build-verify-'));
    mkdirSync(join(workspaceRoot, 'checkout'));
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  const config = (overrides: { runner?: CommandRunner } = {}) => ({
    workspaceRoot,
    commands: [{ gate: 'tests' as const, command: 'npm', args: ['test'] }],
    runner: overrides.runner ?? runner(0),
  });

  it('verifies a build whose commands, review and steps all carry evidence', async () => {
    const verdict = await verifyBuildRun(
      {
        run: run(),
        steps: [
          step(),
          step({ id: 'review', title: 'Review', result: 'Reviewed the diff; no blockers.' }),
        ],
      },
      config(),
    );

    expect(verdict.status).toBe('verified');
    expect(verdict.outcome).toBe('verified_complete');
    expect(verdict.gates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ gate: 'tests', status: 'passed' }),
        expect.objectContaining({ gate: 'review', status: 'passed' }),
      ]),
    );
  });

  it('fails when a required gate did not pass', async () => {
    const verdict = await verifyBuildRun(
      {
        run: run(),
        steps: [
          step(),
          step({ id: 'review', title: 'Review', result: 'Reviewed the diff; no blockers.' }),
        ],
      },
      config({ runner: runner(1) }),
    );

    expect(verdict.status).toBe('failed');
    expect(verdict.gates).toEqual(
      expect.arrayContaining([expect.objectContaining({ gate: 'tests', status: 'failed' })]),
    );
    expect(verdict.blockers.join(' ')).toContain('tests');
  });

  it('fails when the review step retained no evidence', async () => {
    const verdict = await verifyBuildRun(
      {
        run: run(),
        steps: [step(), step({ id: 'review', title: 'Review', result: undefined })],
      },
      config(),
    );

    expect(verdict.status).toBe('failed');
    expect(verdict.gates).toEqual(
      expect.arrayContaining([expect.objectContaining({ gate: 'review', status: 'failed' })]),
    );
  });

  it('fails when a completed step has no retained result', async () => {
    const verdict = await verifyBuildRun(
      {
        run: run(),
        steps: [
          step({ result: undefined }),
          step({ id: 'review', title: 'Review', result: 'Reviewed the diff; no blockers.' }),
        ],
      },
      config(),
    );

    expect(verdict.status).toBe('failed');
    expect(verdict.blockers.join(' ')).toContain('no retained evidence');
  });

  it('requires a pull request when delivery policy demands one', async () => {
    const [withoutPullRequest, withPullRequest] = await Promise.all([
      verifyBuildRun(
        {
          run: run(),
          steps: [
            step(),
            step({ id: 'review', title: 'Review', result: 'Reviewed the diff; no blockers.' }),
          ],
        },
        { ...config(), requirePullRequest: true },
      ),
      verifyBuildRun(
        {
          run: run(),
          steps: [
            step(),
            step({
              id: 'review',
              title: 'Review',
              result: 'Opened https://github.com/example/repo/pull/42 for review.',
            }),
          ],
        },
        { ...config(), requirePullRequest: true },
      ),
    ]);

    expect(withoutPullRequest.status).toBe('failed');
    expect(withoutPullRequest.pullRequestUrl).toBeUndefined();
    expect(withPullRequest.status).toBe('verified');
    expect(withPullRequest.pullRequestUrl).toBe('https://github.com/example/repo/pull/42');
  });

  it('fails a run that carries no build plan', async () => {
    const verdict = await verifyBuildRun(
      { run: run({ settings: undefined }), steps: [step()] },
      config(),
    );

    expect(verdict.status).toBe('failed');
    expect(verdict.blockers.join(' ')).toContain('no build plan');
  });

  it('fails when the verification commands cannot run', async () => {
    const verdict = await verifyBuildRun(
      { run: run(), steps: [step()] },
      { workspaceRoot: join(workspaceRoot, 'missing'), commands: config().commands },
    );

    expect(verdict.status).toBe('failed');
    expect(verdict.gates).toEqual([]);
  });

  it("runs commands in the run's own checkout", async () => {
    mkdirSync(join(workspaceRoot, 'second'));
    const cwds: string[] = [];
    const capture: CommandRunner = async (input) => {
      cwds.push(input.cwd);
      return {
        exitCode: 0,
        stdout: '',
        stderr: '',
        timedOut: false,
        cancelled: false,
        durationMs: 1,
      };
    };
    const steps = [
      step(),
      step({ id: 'review', title: 'Review', result: 'Reviewed the diff; no blockers.' }),
    ];

    const first = await verifyBuildRun({ run: run(), steps }, { ...config(), runner: capture });
    const second = await verifyBuildRun(
      { run: run({ settings: { build: build({ workspace: 'second' }) } }), steps },
      { ...config(), runner: capture },
    );

    expect(first.status).toBe('verified');
    expect(second.status).toBe('verified');
    expect(cwds).toEqual([
      realpathSync(join(workspaceRoot, 'checkout')),
      realpathSync(join(workspaceRoot, 'second')),
    ]);
  });

  it('fails closed without a repository or workspace binding', async () => {
    const steps = [step()];
    const { repository: _repository, ...withoutRepository } = build();
    const { workspace: _workspace, ...withoutWorkspace } = build();

    const unboundRepository = await verifyBuildRun(
      { run: run({ settings: { build: withoutRepository } }), steps },
      config(),
    );
    const unboundWorkspace = await verifyBuildRun(
      { run: run({ settings: { build: withoutWorkspace } }), steps },
      config(),
    );

    expect(unboundRepository.status).toBe('failed');
    expect(unboundRepository.summary).toContain('repository binding');
    expect(unboundWorkspace.status).toBe('failed');
    expect(unboundWorkspace.summary).toContain('workspace binding');
  });

  it('rejects a workspace that resolves outside the deployment root', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'build-outside-'));
    try {
      symlinkSync(outside, join(workspaceRoot, 'linked'), 'dir');
      const verdict = await verifyBuildRun(
        { run: run({ settings: { build: build({ workspace: 'linked' }) } }), steps: [step()] },
        config(),
      );

      expect(verdict.status).toBe('failed');
      expect(verdict.summary).toContain('outside the deployment build root');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('fails closed when the bound checkout does not exist', async () => {
    const verdict = await verifyBuildRun(
      { run: run({ settings: { build: build({ workspace: 'missing' }) } }), steps: [step()] },
      config(),
    );

    expect(verdict.status).toBe('failed');
    expect(verdict.summary).toContain('has no checkout');
  });
});
