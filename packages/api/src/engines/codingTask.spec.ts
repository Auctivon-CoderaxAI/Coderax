import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { EngineEvent, EngineRunRequest } from './types';
import type { OpenCodeTransport } from './opencode/adapter';
import { startOpenCodeRun } from './opencode/adapter';

const execFileAsync = promisify(execFile);
const limits = { timeoutMs: 20_000, maxSummaryChars: 500 };

async function runNodeTest(cwd: string): Promise<{ ok: boolean; output: string }> {
  try {
    const result = await execFileAsync(process.execPath, ['--test'], { cwd });
    return { ok: true, output: `${result.stdout}${result.stderr}` };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; code?: number };
    return { ok: false, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

async function collect(events: AsyncIterable<EngineEvent>): Promise<EngineEvent[]> {
  const out: EngineEvent[] = [];
  for await (const event of events) {
    out.push(event);
  }
  return out;
}

/**
 * End-to-end pipeline test on a disposable workspace.
 *
 * A protocol-conformant OpenCode transport performs a real failing test run,
 * a real file edit and a real passing test run, then reports the same tool
 * events the SDK reports. This proves Coderax's adapter executes tools and
 * requires test evidence; it does not claim a live model planned the edit,
 * because no model credential is available in this environment.
 */
describe('disposable coding task through the OpenCode adapter', () => {
  let base: string;
  let privateRoot: string;
  let cloudRoot: string;
  let workspace: string;

  beforeEach(async () => {
    base = await mkdtemp(path.join(os.tmpdir(), 'coderax-coding-task-'));
    privateRoot = path.join(base, 'private');
    cloudRoot = path.join(base, 'cloud');
    workspace = path.join(privateRoot, 'project');
    await mkdir(workspace, { recursive: true });
    await mkdir(cloudRoot, { recursive: true });
    await writeFile(
      path.join(workspace, 'package.json'),
      JSON.stringify({ name: 'disposable-task', type: 'module', private: true }),
    );
    await writeFile(
      path.join(workspace, 'sum.js'),
      'export function sum(a, b) {\n  return a - b;\n}\n',
    );
    await writeFile(
      path.join(workspace, 'sum.test.mjs'),
      [
        "import test from 'node:test';",
        "import assert from 'node:assert/strict';",
        "import { sum } from './sum.js';",
        '',
        "test('adds two numbers', () => {",
        '  assert.equal(sum(2, 3), 5);',
        '});',
        '',
      ].join('\n'),
    );
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('detects the failure, edits the file, reruns and passes', async () => {
    const before = await runNodeTest(workspace);
    expect(before.ok).toBe(false);

    const emitted: unknown[] = [];
    let releaseEvents: (() => void) | undefined;
    const eventsReady = new Promise<void>((resolve) => {
      releaseEvents = resolve;
    });

    const transport: OpenCodeTransport = {
      createSession: async () => ({ id: 'session-e2e' }),
      subscribe: async () => ({
        async *[Symbol.asyncIterator]() {
          await eventsReady;
          for (const event of emitted) {
            yield event;
          }
        },
      }),
      prompt: async () => {
        const failed = await runNodeTest(workspace);
        emitted.push(
          {
            type: 'message.part.updated',
            properties: {
              sessionID: 'session-e2e',
              part: {
                id: 'tool-1',
                sessionID: 'session-e2e',
                messageID: 'm',
                type: 'tool',
                callID: 'call-1',
                tool: 'bash',
                state: { status: 'pending', input: { command: 'node --test' } },
              },
            },
          },
          {
            type: 'message.part.updated',
            properties: {
              sessionID: 'session-e2e',
              part: {
                id: 'tool-1',
                sessionID: 'session-e2e',
                messageID: 'm',
                type: 'tool',
                callID: 'call-1',
                tool: 'bash',
                state: { status: 'completed', output: failed.output },
              },
            },
          },
        );

        await writeFile(
          path.join(workspace, 'sum.js'),
          'export function sum(a, b) {\n  return a + b;\n}\n',
        );
        emitted.push(
          {
            type: 'message.part.updated',
            properties: {
              sessionID: 'session-e2e',
              part: {
                id: 'tool-2',
                sessionID: 'session-e2e',
                messageID: 'm',
                type: 'tool',
                callID: 'call-2',
                tool: 'edit',
                state: { status: 'pending', input: { path: 'sum.js' } },
              },
            },
          },
          { type: 'file.edited', properties: { file: 'sum.js' } },
          {
            type: 'message.part.updated',
            properties: {
              sessionID: 'session-e2e',
              part: {
                id: 'tool-2',
                sessionID: 'session-e2e',
                messageID: 'm',
                type: 'tool',
                callID: 'call-2',
                tool: 'edit',
                state: { status: 'completed', output: 'applied' },
              },
            },
          },
        );

        const passed = await runNodeTest(workspace);
        emitted.push(
          {
            type: 'message.part.updated',
            properties: {
              sessionID: 'session-e2e',
              part: {
                id: 'tool-3',
                sessionID: 'session-e2e',
                messageID: 'm',
                type: 'tool',
                callID: 'call-3',
                tool: 'bash',
                state: { status: 'pending', input: { command: 'node --test' } },
              },
            },
          },
          {
            type: 'message.part.updated',
            properties: {
              sessionID: 'session-e2e',
              part: {
                id: 'tool-3',
                sessionID: 'session-e2e',
                messageID: 'm',
                type: 'tool',
                callID: 'call-3',
                tool: 'bash',
                state: { status: 'completed', output: passed.output },
              },
            },
          },
          {
            type: 'message.part.updated',
            properties: {
              sessionID: 'session-e2e',
              part: {
                id: 'text-1',
                sessionID: 'session-e2e',
                messageID: 'm',
                type: 'text',
                text: 'Fixed the operator in sum.js and the test passes.',
              },
            },
          },
          {
            type: 'session.idle',
            properties: { sessionID: 'session-e2e' },
          },
        );
        if (!passed.ok) {
          throw new Error('the repaired test did not pass');
        }
        releaseEvents?.();
      },
      abort: async () => {},
    };

    const request: EngineRunRequest = {
      taskKey: 'coding-task',
      conversationId: 'coding-task',
      prompt: 'Find the failing test and fix it.',
      mode: 'private',
      workspaceRoot: workspace,
    };

    const started = await startOpenCodeRun(
      { enabled: true, transport, roots: { private: privateRoot, cloud: cloudRoot }, limits },
      request,
    );
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }

    const events = await collect(started.value.events);
    const result = await started.value.result;

    expect(events.filter((event) => event.type === 'tool_call')).toHaveLength(3);
    expect(events.some((event) => event.type === 'file_edit' && event.path === 'sum.js')).toBe(
      true,
    );
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        value: expect.objectContaining({ toolCalls: 3, edits: 1 }),
      }),
    );

    const after = await runNodeTest(workspace);
    expect(after.ok).toBe(true);
    expect(await readFile(path.join(workspace, 'sum.js'), 'utf8')).toContain('return a + b;');
  });
});
