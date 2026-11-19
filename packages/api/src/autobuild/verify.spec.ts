import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CommandRunner } from './verify';
import { summarizeBuild } from './report';
import { createSpawnCommandRunner, redactSecrets, runBuildVerification } from './verify';

function makeWorkspace(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'coderax-verify-'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function fakeRunner(exitByCommand: Record<string, number>): CommandRunner {
  return async (input) => ({
    exitCode: exitByCommand[input.command] ?? 0,
    stdout: `${input.command} stdout`,
    stderr: exitByCommand[input.command] === 0 ? '' : `${input.command} failed`,
    timedOut: false,
    cancelled: false,
    durationMs: 1,
  });
}

describe('runBuildVerification', () => {
  it('records gate evidence from commands that actually pass', async () => {
    const workspace = makeWorkspace();
    writeFileSync(join(workspace.root, 'ok.js'), "process.stdout.write('tests-ok');\n");
    try {
      const result = await runBuildVerification({
        workspaceRoot: workspace.root,
        commands: [{ gate: 'tests', command: 'node', args: ['ok.js'] }],
        runner: createSpawnCommandRunner(),
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.passed).toBe(true);
      expect(result.value.executed).toBe(1);
      expect(result.value.commands[0]).toMatchObject({
        status: 'passed',
        exitCode: 0,
      });
      expect(result.value.commands[0].output).toContain('tests-ok');
      expect(result.value.gates).toEqual([
        expect.objectContaining({ gate: 'tests', status: 'passed' }),
        expect.objectContaining({ gate: 'build', status: 'not_run' }),
        expect.objectContaining({ gate: 'security', status: 'not_run' }),
      ]);
    } finally {
      workspace.cleanup();
    }
  });

  it('turns a non-zero exit into a failed gate and preserves stderr', async () => {
    const workspace = makeWorkspace();
    writeFileSync(
      join(workspace.root, 'bad.js'),
      "process.stderr.write('assertion failed'); process.exit(3);\n",
    );
    try {
      const result = await runBuildVerification({
        workspaceRoot: workspace.root,
        commands: [{ gate: 'build', command: 'node', args: ['bad.js'] }],
        runner: createSpawnCommandRunner(),
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.passed).toBe(false);
      expect(result.value.gates.find((gate) => gate.gate === 'build')?.status).toBe('failed');
      expect(result.value.commands[0].output).toContain('assertion failed');
      expect(result.value.commands[0].output).toContain('exit code: 3');
    } finally {
      workspace.cleanup();
    }
  });

  it('kills a command that exceeds its timeout', async () => {
    const workspace = makeWorkspace();
    writeFileSync(join(workspace.root, 'hang.js'), 'setTimeout(() => {}, 30_000);\n');
    try {
      const result = await runBuildVerification({
        workspaceRoot: workspace.root,
        commands: [{ gate: 'tests', command: 'node', args: ['hang.js'], timeoutMs: 300 }],
        runner: createSpawnCommandRunner(),
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.commands[0].timedOut).toBe(true);
      expect(result.value.commands[0].status).toBe('failed');
      expect(result.value.passed).toBe(false);
    } finally {
      workspace.cleanup();
    }
  });

  it('stops and marks the verification cancelled when aborted', async () => {
    const workspace = makeWorkspace();
    writeFileSync(join(workspace.root, 'hang.js'), 'setTimeout(() => {}, 30_000);\n');
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 150);
    try {
      const result = await runBuildVerification({
        workspaceRoot: workspace.root,
        commands: [{ gate: 'tests', command: 'node', args: ['hang.js'], timeoutMs: 10_000 }],
        runner: createSpawnCommandRunner(),
        signal: controller.signal,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.cancelled).toBe(true);
      expect(result.value.passed).toBe(false);
    } finally {
      workspace.cleanup();
    }
  });

  it('feeds executed gate evidence into the existing build report', async () => {
    const verification = await runBuildVerification({
      workspaceRoot: process.cwd(),
      commands: [{ gate: 'tests', command: 'pass' }],
      allowedCommands: ['pass'],
      runner: fakeRunner({ pass: 0 }),
    });
    expect(verification.ok).toBe(true);
    if (!verification.ok) return;
    const report = summarizeBuild({
      mode: 'verified',
      status: 'completed',
      steps: [
        {
          id: 'testing',
          title: 'Run tests',
          role: 'testing',
          status: 'completed',
          attempts: 1,
          result: 'The test command passed.',
        },
      ],
      gates: verification.value.gates,
      requiredGates: ['tests'],
      pullRequest: {
        url: 'https://github.com/example/repo/pull/1',
        state: 'open',
        checks: 'passed',
      },
    });
    expect(report.verified).toBe(true);
    expect(report.gates.find((gate) => gate.gate === 'tests')).toMatchObject({
      status: 'passed',
      command: 'pass',
    });
  });

  it('aggregates mixed gate results without assuming an unconfigured gate', async () => {
    const result = await runBuildVerification({
      workspaceRoot: process.cwd(),
      commands: [
        { gate: 'tests', command: 'pass' },
        { gate: 'build', command: 'fail' },
      ],
      allowedCommands: ['pass', 'fail'],
      runner: fakeRunner({ pass: 0, fail: 1 }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.passed).toBe(false);
    expect(result.value.gates).toEqual([
      expect.objectContaining({ gate: 'tests', status: 'passed' }),
      expect.objectContaining({ gate: 'build', status: 'failed' }),
      expect.objectContaining({ gate: 'security', status: 'not_run' }),
    ]);
    expect(result.value.executed).toBe(2);
  });

  it('rejects paths, unknown executables, and commands outside the workspace', async () => {
    const workspace = makeWorkspace();
    try {
      const pathResult = await runBuildVerification({
        workspaceRoot: workspace.root,
        commands: [{ gate: 'tests', command: './node', args: [] }],
      });
      expect(pathResult).toMatchObject({ ok: false, error: { code: 'invalid_command' } });

      const unknown = await runBuildVerification({
        workspaceRoot: workspace.root,
        commands: [{ gate: 'tests', command: 'curl' }],
      });
      expect(unknown).toMatchObject({ ok: false, error: { code: 'invalid_command' } });

      const traversal = await runBuildVerification({
        workspaceRoot: workspace.root,
        commands: [{ gate: 'tests', command: 'node', args: ['-v'], cwd: '..' }],
      });
      expect(traversal).toMatchObject({ ok: false, error: { code: 'invalid_command' } });

      const absolute = await runBuildVerification({
        workspaceRoot: workspace.root,
        commands: [{ gate: 'tests', command: 'node', args: ['-v'], cwd: tmpdir() }],
      });
      expect(absolute).toMatchObject({ ok: false, error: { code: 'invalid_command' } });
    } finally {
      workspace.cleanup();
    }
  });

  it('requires at least one command and an absolute workspace root', async () => {
    await expect(
      runBuildVerification({ workspaceRoot: process.cwd(), commands: [] }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'no_commands' } });
    await expect(
      runBuildVerification({
        workspaceRoot: 'relative/path',
        commands: [{ gate: 'tests', command: 'node' }],
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'invalid_workspace' } });
    await expect(
      runBuildVerification({
        workspaceRoot: join(tmpdir(), 'coderax-missing-workspace-20261118'),
        commands: [{ gate: 'tests', command: 'node' }],
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'invalid_workspace' } });
  });

  it('redacts credential-shaped output and supplied secret values', () => {
    const output = redactSecrets(
      'token=abcd1234 Bearer abcdefghijklmnop ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa supersecret',
      ['supersecret'],
    );
    expect(output).not.toContain('abcd1234');
    expect(output).not.toContain('abcdefghijklmnop');
    expect(output).not.toContain('ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(output).not.toContain('supersecret');
    expect(output).toContain('[redacted]');
  });
});
