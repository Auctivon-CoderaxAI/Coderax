import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { BuildGateEvidence, BuildGateStatus } from './report';

/**
 * Review is a human/model judgement, not a shell command. A command runner can
 * only produce evidence for gates that are actually observable from a process.
 */
export const VERIFICATION_GATES = ['tests', 'build', 'security'] as const;

export type VerificationGate = (typeof VERIFICATION_GATES)[number];

/**
 * Package managers and language toolchains that are ordinary for a Coderax
 * workspace. Anything else must be opted into explicitly by the caller so a
 * build plan cannot turn into arbitrary command execution.
 */
export const DEFAULT_ALLOWED_VERIFICATION_COMMANDS = [
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'bun',
  'node',
  'deno',
  'tsc',
  'eslint',
  'prettier',
  'jest',
  'vitest',
  'mocha',
  'playwright',
  'cypress',
  'python',
  'python3',
  'pytest',
  'ruff',
  'mypy',
  'uv',
  'poetry',
  'go',
  'cargo',
  'rustc',
  'dotnet',
  'mvn',
  'gradle',
  'make',
  'cmake',
  'bash',
  'sh',
  'audit',
  'semgrep',
  'trivy',
  'gitleaks',
] as const;

const MAX_COMMANDS = 20;
const MAX_ARGS = 50;
const MAX_ARG_LENGTH = 2_000;
const MAX_COMMAND_LENGTH = 256;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 60 * 60_000;
const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_MAX_OUTPUT_BYTES = 64_000;

/**
 * Windows `spawn` cannot launch npm/pnpm `.cmd` shims without a shell. When the
 * shell is enabled, arguments are restricted to characters with no cmd.exe
 * meaning, which keeps the invocation equivalent to an argv execution.
 */
const WINDOWS_SAFE_ARG = /^[A-Za-z0-9_@+=:,./\\-]+$/;

export interface VerificationCommand {
  gate: VerificationGate;
  /** Executable name only, for example `npm`. Paths are rejected. */
  command: string;
  args?: string[];
  /** Relative to the workspace root. Defaults to the root itself. */
  cwd?: string;
  timeoutMs?: number;
  label?: string;
}

export interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
  durationMs: number;
}

export type CommandRunner = (input: {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
}) => Promise<CommandResult>;

export interface VerificationCommandResult extends CommandResult {
  gate: VerificationGate;
  label: string;
  display: string;
  status: 'passed' | 'failed';
  /** Bounded, redacted stdout+stderr retained as the gate evidence. */
  output: string;
}

export interface BuildVerification {
  gates: BuildGateEvidence[];
  commands: VerificationCommandResult[];
  startedAt: string;
  finishedAt: string;
  executed: number;
  /** True only when every command that was supplied passed. */
  passed: boolean;
  cancelled: boolean;
}

export type VerificationErrorCode =
  | 'invalid_workspace'
  | 'no_commands'
  | 'too_many_commands'
  | 'invalid_command';

export type VerificationResult =
  | { ok: true; value: BuildVerification }
  | { ok: false; error: { code: VerificationErrorCode; message: string } };

export interface RunBuildVerificationInput {
  workspaceRoot: string;
  commands: readonly VerificationCommand[];
  runner?: CommandRunner;
  /** Replaces the default allowlist when supplied. */
  allowedCommands?: readonly string[];
  defaultTimeoutMs?: number;
  signal?: AbortSignal;
  secrets?: readonly string[];
  now?: () => Date;
}

interface NormalizedCommand {
  gate: VerificationGate;
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  label: string;
  display: string;
}

function fail(code: VerificationErrorCode, message: string): VerificationResult {
  return { ok: false, error: { code, message } };
}

function allowedSet(allowed: readonly string[] | undefined): Set<string> {
  return new Set(
    (allowed ?? DEFAULT_ALLOWED_VERIFICATION_COMMANDS).map((entry) => entry.toLowerCase()),
  );
}

function displayCommand(command: string, args: string[]): string {
  const quote = (value: string): string =>
    value.length === 0 || /[\s"']/.test(value) ? JSON.stringify(value) : value;
  return [command, ...args.map(quote)].join(' ');
}

/**
 * Redact common credential shapes plus any explicitly supplied secret values.
 * Output is retained as evidence, so it must never become a credential leak.
 */
export function redactSecrets(text: string, secrets: readonly string[] = []): string {
  let next = text;
  for (const secret of secrets) {
    if (secret.length < 4) {
      continue;
    }
    next = next.split(secret).join('[redacted]');
  }
  return next
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,})\b/g, '[redacted]')
    .replace(/\bsk-[A-Za-z0-9]{20,}\b/g, '[redacted]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[redacted]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[redacted]')
    .replace(
      /((?:api[_-]?key|access[_-]?token|token|secret|password|credential)\s*[:=]\s*)[^\s,;]+/gi,
      '$1[redacted]',
    );
}

/** Values of environment variables whose names look like credentials. */
export function sensitiveEnvironmentValues(env: NodeJS.ProcessEnv = process.env): string[] {
  return Object.entries(env)
    .filter(([name, value]) => {
      if (value == null || value.length < 8) {
        return false;
      }
      return /(?:TOKEN|SECRET|PASSWORD|PASSWD|API[_-]?KEY|PRIVATE[_-]?KEY|CREDENTIAL)/i.test(name);
    })
    .map(([, value]) => value as string);
}

function boundedOutput(value: string, maxBytes: number): string {
  if (value.length <= maxBytes) {
    return value;
  }
  return `${value.slice(0, maxBytes)}\n[output truncated at ${maxBytes} characters]`;
}

function insideRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel.length === 0 || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function normalizeCommand(
  input: VerificationCommand,
  root: string,
  allowed: Set<string>,
  defaultTimeoutMs: number,
): { ok: true; value: NormalizedCommand } | { ok: false; message: string } {
  if (!VERIFICATION_GATES.includes(input.gate)) {
    return { ok: false, message: `Unknown verification gate: ${String(input.gate)}` };
  }
  const command = input.command.trim();
  if (command.length === 0 || command.length > MAX_COMMAND_LENGTH) {
    return { ok: false, message: 'A verification command needs a short executable name' };
  }
  if (command.includes('/') || command.includes('\\')) {
    return { ok: false, message: `Use an allowlisted executable name, not a path: ${command}` };
  }
  if (!allowed.has(command.toLowerCase())) {
    return {
      ok: false,
      message: `Command not allowed by the verification allowlist: ${command}`,
    };
  }
  const args = input.args ?? [];
  if (!Array.isArray(args) || args.length > MAX_ARGS) {
    return { ok: false, message: `A command may have at most ${MAX_ARGS} arguments` };
  }
  for (const arg of args) {
    if (typeof arg !== 'string' || arg.length > MAX_ARG_LENGTH) {
      return {
        ok: false,
        message: `Each argument must be a string of at most ${MAX_ARG_LENGTH} characters`,
      };
    }
    if (arg.includes('\0') || arg.includes('\n') || arg.includes('\r')) {
      return { ok: false, message: 'Arguments cannot contain control characters' };
    }
    if (process.platform === 'win32' && !WINDOWS_SAFE_ARG.test(arg)) {
      return {
        ok: false,
        message: `This argument is not safe for a Windows command invocation: ${arg}`,
      };
    }
  }
  let cwd = resolve(root, input.cwd ?? '.');
  try {
    // Resolve symlinks so a path inside the workspace cannot point outside it.
    cwd = realpathSync(cwd);
  } catch {
    // A missing directory is left for spawn to report as a failed command.
  }
  if (!insideRoot(root, cwd)) {
    return { ok: false, message: 'A verification command cannot run outside the workspace root' };
  }
  const timeoutMs = input.timeoutMs ?? defaultTimeoutMs;
  if (!Number.isFinite(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
    return {
      ok: false,
      message: `A timeout must be between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS} ms`,
    };
  }
  return {
    ok: true,
    value: {
      gate: input.gate,
      command,
      args: [...args],
      cwd,
      timeoutMs,
      label: input.label?.trim() || command,
      display: displayCommand(command, args),
    },
  };
}

function killTree(child: ChildProcess): void {
  if (child.pid == null || child.killed) {
    return;
  }
  if (process.platform === 'win32') {
    try {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.on('error', () => {
        try {
          child.kill();
        } catch {
          /* The process already exited. */
        }
      });
      killer.unref();
    } catch {
      try {
        child.kill();
      } catch {
        /* The process already exited. */
      }
    }
    return;
  }
  try {
    // The child is its own process-group leader, so this also stops descendants.
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* The process already exited. */
    }
  }
}

/**
 * Real process runner. It never uses a POSIX shell; on Windows the shell is
 * used only to resolve `.cmd` shims, with arguments restricted to safe tokens.
 */
export function createSpawnCommandRunner(
  options: { env?: NodeJS.ProcessEnv; maxOutputBytes?: number } = {},
): CommandRunner {
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  return (input) => {
    const startedAt = Date.now();
    if (input.signal?.aborted === true) {
      return Promise.resolve({
        exitCode: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        cancelled: true,
        durationMs: 0,
      });
    }
    return new Promise<CommandResult>((resolveResult) => {
      let child: ChildProcess;
      try {
        child = spawn(input.command, input.args, {
          cwd: input.cwd,
          env: options.env ?? process.env,
          shell: process.platform === 'win32',
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: process.platform !== 'win32',
        });
      } catch (error) {
        resolveResult({
          exitCode: null,
          stdout: '',
          stderr: error instanceof Error ? error.message : String(error),
          timedOut: false,
          cancelled: false,
          durationMs: Date.now() - startedAt,
        });
        return;
      }

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let cancelled = false;
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const cleanup = (): void => {
        if (timer != null) {
          clearTimeout(timer);
        }
        input.signal?.removeEventListener('abort', onAbort);
      };
      const finish = (exitCode: number | null): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolveResult({
          exitCode,
          stdout,
          stderr,
          timedOut,
          cancelled,
          durationMs: Date.now() - startedAt,
        });
      };
      const onAbort = (): void => {
        if (settled) {
          return;
        }
        cancelled = true;
        killTree(child);
      };

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout = boundedOutput(stdout + chunk.toString('utf8'), maxOutputBytes);
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr = boundedOutput(stderr + chunk.toString('utf8'), maxOutputBytes);
      });
      child.on('error', (error) => {
        stderr = boundedOutput(
          `${stderr}${stderr.length > 0 ? '\n' : ''}${error.message}`,
          maxOutputBytes,
        );
        finish(null);
      });
      child.on('close', (code) => finish(code));
      input.signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => {
        if (settled) {
          return;
        }
        timedOut = true;
        killTree(child);
      }, input.timeoutMs);

      if (input.signal?.aborted === true) {
        onAbort();
      }
    });
  };
}

/**
 * Execute the supplied commands sequentially and convert the results into
 * gate evidence. Commands are validated before the first process starts, so an
 * invalid entry cannot leave a half-run verification behind.
 */
export async function runBuildVerification(
  input: RunBuildVerificationInput,
): Promise<VerificationResult> {
  if (!isAbsolute(input.workspaceRoot ?? '')) {
    return fail('invalid_workspace', 'The workspace root must be an absolute path');
  }
  let root: string;
  try {
    root = realpathSync(resolve(input.workspaceRoot));
    if (!statSync(root).isDirectory()) {
      throw new Error('not a directory');
    }
  } catch {
    return fail('invalid_workspace', 'The workspace root must be an existing directory');
  }
  if (input.commands.length === 0) {
    return fail('no_commands', 'At least one verification command is required');
  }
  if (input.commands.length > MAX_COMMANDS) {
    return fail('too_many_commands', `At most ${MAX_COMMANDS} verification commands are allowed`);
  }

  const allowed = allowedSet(input.allowedCommands);
  const defaultTimeoutMs = input.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const normalized: NormalizedCommand[] = [];
  for (const command of input.commands) {
    const result = normalizeCommand(command, root, allowed, defaultTimeoutMs);
    if (!result.ok) {
      return fail('invalid_command', result.message);
    }
    normalized.push(result.value);
  }

  const runner = input.runner ?? createSpawnCommandRunner();
  const secrets = input.secrets ?? sensitiveEnvironmentValues();
  const now = input.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const results: VerificationCommandResult[] = [];
  let cancelled = false;

  for (const command of normalized) {
    if (input.signal?.aborted === true) {
      cancelled = true;
      break;
    }
    const result = await runner({
      command: command.command,
      args: command.args,
      cwd: command.cwd,
      timeoutMs: command.timeoutMs,
      ...(input.signal == null ? {} : { signal: input.signal }),
    });
    if (result.cancelled) {
      cancelled = true;
    }
    const passed = !result.cancelled && !result.timedOut && result.exitCode === 0;
    const rawOutput = [
      result.stdout.trim(),
      result.stderr.trim(),
      result.timedOut ? `[timed out after ${command.timeoutMs} ms]` : '',
      `[exit code: ${result.exitCode == null ? 'none' : result.exitCode}]`,
    ]
      .filter((entry) => entry.length > 0)
      .join('\n');
    results.push({
      ...result,
      gate: command.gate,
      label: command.label,
      display: command.display,
      status: passed ? 'passed' : 'failed',
      output: boundedOutput(redactSecrets(rawOutput, secrets), DEFAULT_MAX_OUTPUT_BYTES),
    });
    if (cancelled) {
      break;
    }
  }

  const gates: BuildGateEvidence[] = VERIFICATION_GATES.map((gate) => {
    const entries = results.filter((entry) => entry.gate === gate);
    if (entries.length === 0) {
      return {
        gate,
        status: 'not_run' as BuildGateStatus,
        summary: 'No command was configured for this gate',
      };
    }
    const failed = entries.filter((entry) => entry.status === 'failed');
    const status: BuildGateStatus = failed.length === 0 ? 'passed' : 'failed';
    return {
      gate,
      status,
      command: entries.map((entry) => entry.display).join('; '),
      summary: `${entries.length - failed.length}/${entries.length} command(s) passed${
        cancelled ? ' before cancellation' : ''
      }`,
    };
  });

  return {
    ok: true,
    value: {
      gates,
      commands: results,
      startedAt,
      finishedAt: now().toISOString(),
      executed: results.length,
      passed: results.length > 0 && results.every((entry) => entry.status === 'passed'),
      cancelled,
    },
  };
}

/** Convenience alias for callers that only need the gate evidence. */
export function gateEvidence(verification: BuildVerification): BuildGateEvidence[] {
  return verification.gates.filter((gate) => gate.status !== 'not_run');
}
