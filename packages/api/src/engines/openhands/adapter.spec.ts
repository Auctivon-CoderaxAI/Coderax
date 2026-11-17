import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import type { EngineEvent, EngineRunRequest } from '../types';
import type { OpenHandsTransport } from './adapter';
import {
  createOpenHandsAdapter,
  OpenHandsEventMapper,
  startOpenHandsRun,
} from './adapter';

const limits = { timeoutMs: 2_000, maxSummaryChars: 200 };

describe('OpenHands adapter', () => {
  let base: string;
  let privateRoot: string;
  let cloudRoot: string;

  beforeEach(async () => {
    base = await mkdtemp(path.join(os.tmpdir(), 'coderax-openhands-'));
    privateRoot = path.join(base, 'private');
    cloudRoot = path.join(base, 'cloud');
    await mkdir(privateRoot);
    await mkdir(cloudRoot);
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('is disabled by default and reports why it cannot run', () => {
    const adapter = createOpenHandsAdapter({
      enabled: false,
      roots: { private: privateRoot, cloud: cloudRoot },
      limits,
    });
    expect(adapter.describe()).toEqual(
      expect.objectContaining({ available: false, reason: 'disabled' }),
    );
  });

  it('requires a remote Agent Server and never starts one implicitly', async () => {
    const started = await startOpenHandsRun(
      { enabled: true, roots: { private: privateRoot, cloud: cloudRoot }, limits },
      {
        taskKey: 't',
        conversationId: 't',
        prompt: 'fix it',
        mode: 'private',
        workspaceRoot: privateRoot,
      },
    );
    expect(started).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: 'not_configured' }),
      }),
    );
  });

  it('maps agent actions to tool evidence', () => {
    const mapper = new OpenHandsEventMapper('conversation-1');
    expect(
      mapper.map({
        kind: 'ActionEvent',
        id: 'action-1',
        action: { kind: 'BashAction', command: 'npm test' },
      }),
    ).toEqual([
      {
        type: 'tool_call',
        callId: 'action-1',
        tool: 'bash',
        input: { summary: 'npm test' },
      },
    ]);
    expect(
      mapper.map({
        kind: 'ObservationEvent',
        action_id: 'action-1',
        observation: { content: '1 failing' },
      }),
    ).toEqual([
      { type: 'tool_result', callId: 'action-1', tool: 'bash', ok: true, output: '1 failing' },
    ]);
    expect(
      mapper.map({
        kind: 'ConversationStateUpdateEvent',
        status: 'finished',
      }),
    ).toEqual([{ type: 'completed', sessionId: 'conversation-1' }]);
  });

  it('runs through a configured transport and streams its evidence', async () => {
    const transport: OpenHandsTransport = {
      start: async () => ({
        conversationId: 'c1',
        events: (async function* () {
          yield {
            kind: 'ActionEvent',
            id: 'a1',
            action: { kind: 'FileEditAction', path: 'sum.ts' },
          };
          yield {
            kind: 'ObservationEvent',
            action_id: 'a1',
            observation: { content: 'edited' },
          };
          yield { kind: 'ConversationStateUpdateEvent', status: 'finished' };
        })(),
      }),
      cancel: async () => {},
    };

    const request: EngineRunRequest = {
      taskKey: 't',
      conversationId: 't',
      prompt: 'fix it',
      mode: 'private',
      workspaceRoot: privateRoot,
    };
    const started = await startOpenHandsRun(
      {
        enabled: true,
        agentServerUrl: 'http://127.0.0.1:3000',
        transport,
        roots: { private: privateRoot, cloud: cloudRoot },
        limits,
      },
      request,
    );
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    const events: EngineEvent[] = [];
    for await (const event of started.value.events) {
      events.push(event);
    }
    expect(events).toEqual([
      { type: 'started', sessionId: 'c1' },
      {
        type: 'tool_call',
        callId: 'a1',
        tool: 'edit',
        input: { summary: 'sum.ts' },
      },
      { type: 'tool_result', callId: 'a1', tool: 'edit', ok: true, output: 'edited' },
      { type: 'completed', sessionId: 'c1' },
    ]);
    await expect(started.value.result).resolves.toEqual(
      expect.objectContaining({ ok: true }),
    );
  });
});
