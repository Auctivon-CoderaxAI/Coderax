import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import type { Request, Response } from 'express';
import type { EngineWorkChatConfig, EngineWorkChatRunner, EngineWorkChatStore } from './types';
import type { OpenCodeTransport } from '../opencode/adapter';
import { createEngineWorkChatHandler } from './handler';
import { startOpenCodeRun } from '../opencode/adapter';

/**
 * Whole-turn check: the handler builds the Work prompt, the real OpenCode
 * adapter runs it against a transport that replays an OpenCode session (the
 * user's own part included), and the real mapper turns that stream into the
 * reply. The prompt the server sent must never come back as the answer.
 */

const PROMPT = 'Run the shell command head -c 16 /dev/urandom | md5sum';

type FakeResponse = Response & {
  chunks: string[];
  body: unknown;
  statusCode: number;
  status: jest.Mock;
  json: jest.Mock;
  setHeader: jest.Mock;
  flushHeaders: jest.Mock;
  write: jest.Mock;
  end: jest.Mock;
  on: jest.Mock;
};

function fakeResponse(): FakeResponse {
  const response = {
    statusCode: 200,
    body: undefined,
    chunks: [],
    writableEnded: false,
    destroyed: false,
  } as unknown as FakeResponse;
  response.status = jest.fn((code: number) => {
    response.statusCode = code;
    return response;
  });
  response.json = jest.fn((body: unknown) => {
    response.body = body;
    return response;
  });
  response.setHeader = jest.fn(() => response);
  response.flushHeaders = jest.fn();
  response.write = jest.fn((chunk: string) => {
    response.chunks.push(chunk);
    return true;
  });
  response.end = jest.fn(() => response);
  response.on = jest.fn(() => response);
  return response;
}

type Frame = {
  type?: string;
  index?: number;
  text?: string;
  tool_call?: Record<string, unknown>;
  final?: true;
  terminalStatus?: string;
  toolCalls?: number;
  edits?: number;
  responseMessage?: Record<string, unknown>;
};

function frames(response: FakeResponse): Frame[] {
  return response.chunks
    .join('')
    .split('\n\n')
    .filter(Boolean)
    .map((block) => JSON.parse(block.replace(/^event: message\ndata: /, '')) as Frame);
}

function sessionTransport(sessionId: string): OpenCodeTransport {
  const part = (id: string, messageID: string, text: string) => ({
    type: 'message.part.updated',
    properties: {
      sessionID: sessionId,
      part: { id, sessionID: sessionId, messageID, type: 'text', text },
    },
  });
  const tool = (status: string, extra: Record<string, unknown> = {}) => ({
    type: 'message.part.updated',
    properties: {
      sessionID: sessionId,
      part: {
        id: 'tool-part',
        sessionID: sessionId,
        messageID: 'm-assistant',
        type: 'tool',
        callID: 'call-1',
        tool: 'bash',
        state: { status, input: { command: 'head -c 16 /dev/urandom | md5sum' }, ...extra },
      },
    },
  });
  return {
    createSession: async () => ({ id: sessionId }),
    subscribe: async () => ({
      async *[Symbol.asyncIterator]() {
        yield { type: 'server.connected', properties: {} };
        yield {
          type: 'message.updated',
          properties: {
            sessionID: sessionId,
            info: { id: 'm-user', sessionID: sessionId, role: 'user' },
          },
        };
        yield {
          type: 'message.updated',
          properties: {
            sessionID: sessionId,
            info: { id: 'm-assistant', sessionID: sessionId, role: 'assistant' },
          },
        };
        // OpenCode streams the prompt as a part of the user's message.
        yield part('p-user', 'm-user', buildExpectedPrompt());
        yield tool('running');
        yield part('p-assistant', 'm-assistant', 'Checked the workspace. ');
        yield tool('completed', { output: '9f2c1d3e' });
        yield { type: 'file.edited', properties: { file: 'notes.md' } };
        yield part('p-assistant', 'm-assistant', 'Checked the workspace. The hash is 9f2c1d3e.');
        yield { type: 'session.idle', properties: { sessionID: sessionId } };
      },
    }),
    prompt: async () => undefined,
    abort: async () => undefined,
  };
}

/** The prompt the handler sends for a fresh conversation (no history). */
function buildExpectedPrompt(): string {
  return PROMPT;
}

describe('Work engine turn end-to-end', () => {
  let base: string;
  let privateRoot: string;
  let cloudRoot: string;

  beforeEach(async () => {
    base = await mkdtemp(path.join(os.tmpdir(), 'coderax-work-e2e-'));
    privateRoot = path.join(base, 'private');
    cloudRoot = path.join(base, 'cloud');
    await mkdir(privateRoot);
    await mkdir(cloudRoot);
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('answers with the engine output, never with the prompt it sent', async () => {
    const saved: Array<{ text: string; isCreatedByUser: boolean }> = [];
    const store: EngineWorkChatStore = {
      getConversation: async () => null,
      saveConversation: async () => undefined,
      saveMessage: async (message) => {
        saved.push({ text: message.text, isCreatedByUser: message.isCreatedByUser });
      },
      loadTranscript: async () => [],
    };
    const runner: EngineWorkChatRunner = {
      start: async (input) =>
        startOpenCodeRun(
          {
            enabled: true,
            roots: { private: privateRoot, cloud: cloudRoot },
            limits: { timeoutMs: 5_000, maxSummaryChars: 4_000 },
            transport: sessionTransport('session-e2e'),
          },
          {
            taskKey: input.conversationId,
            conversationId: input.conversationId,
            prompt: input.prompt,
            mode: 'private',
            workspaceRoot: privateRoot,
          },
        ),
      state: async () => null,
      cancel: async () => false,
      snapshot: () => ({ defaultEngine: 'opencode', engines: [] }),
    };
    const handler = createEngineWorkChatHandler({
      runtimeFor: () => runner,
      storeFor: () => store,
    });
    const config = {
      engines: {
        workChat: { enabled: true, mode: 'cloud' },
        opencode: { enabled: true },
      },
    } as unknown as EngineWorkChatConfig;
    const request = {
      method: 'POST',
      path: '/chat',
      body: { text: PROMPT, conversationId: 'new', workAgent: 'opencode' },
      user: { id: 'owner', role: 'ADMIN', tenantId: 'tenant-1' },
      config: { config },
    } as unknown as Request;
    const response = fakeResponse();

    await handler(request, response, jest.fn());

    const sent = frames(response);
    /* The reply streams as content parts, so the client renders the text and
     * the tool call in one message instead of a bare text row. */
    const textFrames = sent.filter((frame) => frame.type === 'text');
    expect(textFrames[textFrames.length - 1]).toMatchObject({
      index: 0,
      text: 'Checked the workspace. The hash is 9f2c1d3e.',
    });
    const text = textFrames.map((frame) => String(frame.text)).join('\n');
    expect(text).not.toContain('head -c 16');
    expect(text).not.toContain('Current request:');

    const toolFrames = sent.filter((frame) => frame.type === 'tool_call');
    expect(toolFrames[0]).toMatchObject({
      index: 1,
      tool_call: {
        id: 'call-1',
        name: 'bash',
        args: { command: 'head -c 16 /dev/urandom | md5sum' },
      },
    });
    expect(toolFrames[toolFrames.length - 1]).toMatchObject({
      index: 1,
      tool_call: { output: '9f2c1d3e', runStepStatus: 'completed' },
    });

    const final = sent.find((frame) => frame.final === true);
    expect(final?.terminalStatus).toBe('complete');
    // The turn really ran a tool and edited a file, so the work is observable.
    expect(final?.toolCalls).toBe(1);
    expect(final?.edits).toBe(1);
    expect(final?.responseMessage).toMatchObject({
      text: 'Checked the workspace. The hash is 9f2c1d3e.',
      sender: 'OpenCode Agent',
      isCreatedByUser: false,
      content: [
        { type: 'text', text: 'Checked the workspace. The hash is 9f2c1d3e.' },
        {
          type: 'tool_call',
          tool_call: {
            id: 'call-1',
            name: 'bash',
            args: { command: 'head -c 16 /dev/urandom | md5sum' },
            output: '9f2c1d3e',
            runStepStatus: 'completed',
          },
        },
      ],
    });
    expect(saved).toEqual([
      { text: PROMPT, isCreatedByUser: true },
      { text: 'Checked the workspace. The hash is 9f2c1d3e.', isCreatedByUser: false },
    ]);
  });
});
