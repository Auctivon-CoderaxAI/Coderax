import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { CommandRunner } from './verify';
import {
  createSpawnCommandRunner,
  gateEvidence,
  redactSecrets,
  runBuildVerification,
} from './verify';
import { summarizeBuild } from './report';

jest.mock('node:child_process', () => ({
  ...jest.requireActual('node:child_process'),
  spawn: jest.fn(jest.requireActual('node:child_process').spawn),
}));

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

describe('spawn cleanup', () => {
  it.each(['timeout', 'cancellation'])(
    'settles after %s even without a close event',
    async (kind) => {
      jest.useFakeTimers();
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        unref: jest.fn(),
      });
      jest.mocked(spawn).mockReturnValueOnce(child as unknown as ReturnType<typeof spawn>);
      const controller = new AbortController();
      try {
        const result = createSpawnCommandRunner({ env: {} })({
          command: 'node',
          args: [],
          cwd: process.cwd(),
          timeoutMs: 200,
          signal: controller.signal,
        });
        if (kind === 'cancellation') controller.abort();
        await jest.advanceTimersByTimeAsync(1_200);
        await expect(result).resolves.toMatchObject({
          exitCode: null,
          cancelled: kind === 'cancellation',
          timedOut: kind === 'timeout',
        });
        expect(child.stdout.destroyed).toBe(true);
        expect(child.stderr.destroyed).toBe(true);
      } finally {
        jest.useRealTimers();
      }
    },
  );
});

describe('runBuildVerification', () => {
  it('redacts display evidence even for commands cancelled before they run', async () => {
    const signal = new AbortController();
    const secret = 'example" quoted secret';
    const commands = [
      {
        gate: 'tests' as const,
        command: 'node',
        args: ['--token=second-secret', secret],
        label: secret,
      },
    ];
    const runner = jest.fn(fakeRunner({ node: 0 }));
    const input = { workspaceRoot: process.cwd(), commands, runner, secrets: [secret] };
    const result = await runBuildVerification(input);
    expect(result).toMatchObject({
      ok: true,
      value: {
        commands: [{ display: 'node --token=[redacted] [redacted]', label: '[redacted]' }],
      },
    });
    expect(runner).toHaveBeenCalledWith(expect.objectContaining({ args: commands[0].args }));
    signal.abort();
    const cancelled = await runBuildVerification({ ...input, signal: signal.signal });
    expect(cancelled).toMatchObject({
      ok: true,
      value: {
        commands: [],
        gates: expect.arrayContaining([
          expect.objectContaining({ gate: 'tests', command: 'node --token=[redacted] [redacted]' }),
        ]),
      },
    });
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('uses only the explicit job environment', async () => {
    const workspace = makeWorkspace();
    const prior = process.env.VERIFICATION_PARENT_ONLY;
    process.env.VERIFICATION_PARENT_ONLY = 'parent-fixture';
    try {
      writeFileSync(
        join(workspace.root, 'env.js'),
        "process.stdout.write([process.env.VERIFICATION_PARENT_ONLY ?? 'missing', process.env.JOB_SETTING].join(':'));",
      );
      const input = {
        workspaceRoot: workspace.root,
        commands: [{ gate: 'tests' as const, command: 'node', args: ['env.js'] }],
      };
      await expect(runBuildVerification(input)).resolves.toMatchObject({
        ok: false,
        error: { code: 'invalid_environment' },
      });
      const result = await runBuildVerification({
        ...input,
        env: { PATH: process.env.PATH, JOB_SETTING: 'present' },
      });
      expect(result).toMatchObject({
        ok: true,
        value: { passed: true, commands: [{ stdout: 'missing:present' }] },
      });
    } finally {
      if (prior == null) delete process.env.VERIFICATION_PARENT_ONLY;
      else process.env.VERIFICATION_PARENT_ONLY = prior;
      workspace.cleanup();
    }
  });

  it('stops before invoking a later command if its directory disappeared', async () => {
    const workspace = makeWorkspace();
    const cwd = join(workspace.root, 'later');
    mkdirSync(cwd);
    const run = fakeRunner({ node: 0 });
    const runner = jest.fn<ReturnType<CommandRunner>, Parameters<CommandRunner>>(async (input) => {
      rmSync(cwd, { recursive: true });
      return run(input);
    });
    try {
      const result = await runBuildVerification({
        workspaceRoot: workspace.root,
        runner,
        commands: [
          { gate: 'tests', command: 'node' },
          { gate: 'build', command: 'node', cwd: 'later' },
        ],
      });
      expect(result).toMatchObject({ ok: false, error: { code: 'invalid_command' } });
      expect(runner).toHaveBeenCalledTimes(1);
    } finally {
      workspace.cleanup();
    }
  });

  it('records gate evidence from commands that actually pass', async () => {
    const workspace = makeWorkspace();
    writeFileSync(join(workspace.root, 'ok.js'), "process.stdout.write('tests-ok');\n");
    try {
      const result = await runBuildVerification({
        workspaceRoot: workspace.root,
        commands: [{ gate: 'tests', command: 'node', args: ['ok.js'] }],
        runner: createSpawnCommandRunner({ env: { PATH: process.env.PATH } }),
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
        runner: createSpawnCommandRunner({ env: { PATH: process.env.PATH } }),
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
        runner: createSpawnCommandRunner({ env: { PATH: process.env.PATH } }),
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
        runner: createSpawnCommandRunner({ env: { PATH: process.env.PATH } }),
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

  it('does not pass gates with commands skipped after cancellation', async () => {
    const controller = new AbortController();
    const run = fakeRunner({ node: 0 });
    const runner = jest.fn<ReturnType<CommandRunner>, Parameters<CommandRunner>>(async (input) => {
      controller.abort();
      return run(input);
    });
    const result = await runBuildVerification({
      workspaceRoot: process.cwd(),
      commands: [
        { gate: 'tests', command: 'node' },
        { gate: 'tests', command: 'node' },
        { gate: 'build', command: 'node' },
      ],
      signal: controller.signal,
      runner,
    });
    expect(runner).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ cancelled: true, passed: false });
    expect(gateEvidence(result.value)).toEqual([
      expect.objectContaining({
        gate: 'tests',
        status: 'failed',
        summary: '1/2 command(s) passed before cancellation',
      }),
      expect.objectContaining({
        gate: 'build',
        status: 'failed',
        summary: '0/1 command(s) passed before cancellation',
      }),
    ]);
  });

  it('redacts both returned streams and combined command output', async () => {
    const run = fakeRunner({ node: 0 });
    const result = await runBuildVerification({
      workspaceRoot: process.cwd(),
      commands: [{ gate: 'tests', command: 'node' }],
      secrets: ['example-secret'],
      runner: async (input) => ({
        ...(await run(input)),
        stdout: 'out example-secret',
        stderr: 'err example-secret',
      }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.commands[0]).toMatchObject({
      stdout: 'out [redacted]',
      stderr: 'err [redacted]',
      output: expect.stringContaining('out [redacted]\nerr [redacted]'),
    });
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
    expect(report.verified).toBe(false);
    expect(report.missingGates).toEqual(['build', 'security', 'review']);
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
