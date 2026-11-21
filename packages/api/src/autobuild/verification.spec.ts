import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

const run = (overrides: Partial<WorkflowRunRecord> = {}): WorkflowRunRecord => ({
  id: 'run-1',
  userId: 'user-1',
  workflowId: 'wf-1',
  workflowName: 'Build',
  agentId: 'agent-1',
  status: 'running',
  currentStep: 2,
  steps: [],
  settings: {
    build: {
      mode: 'autonomous',
      requiredGates: ['tests', 'review'],
      reviewStepId: 'review',
      requirePullRequest: false,
    },
  },
  startedAt: new Date('2026-01-01T00:00:00.000Z'),
  events: [],
  ...overrides,
});

const runner = (exitCode: number, output = ''): CommandRunner => async () => ({
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
});
