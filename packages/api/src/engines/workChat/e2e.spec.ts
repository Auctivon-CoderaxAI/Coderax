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
  message?: true;
  text?: string;
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
      state: () => null,
      cancel: async () => false,
      snapshot: () => ({ defaultEngine: 'opencode', engines: [] }),
    };
    const handler = createEngineWorkChatHandler({
      runtimeFor: () => runner,
      storeFor: () => store,
    });
    const config = {
      engines: {
        workChat: { enabled: true, engine: 'opencode' },
        opencode: { enabled: true },
      },
    } as unknown as EngineWorkChatConfig;
    const request = {
      method: 'POST',
      path: '/chat',
      body: { text: PROMPT, conversationId: 'new' },
      user: { id: 'owner', role: 'ADMIN', tenantId: 'tenant-1' },
      config: { config },
    } as unknown as Request;
    const response = fakeResponse();

    await handler(request, response, jest.fn());

    const sent = frames(response);
    const text = sent
      .filter((frame) => frame.message === true)
      .map((frame) => String(frame.text))
      .join('');
    expect(text).toContain('Checked the workspace.');
    expect(text).toContain('The hash is 9f2c1d3e.');
    expect(text).not.toContain('head -c 16');
    expect(text).not.toContain('Current request:');

    const final = sent.find((frame) => frame.final === true);
    expect(final?.terminalStatus).toBe('complete');
    // The turn really ran a tool and edited a file, so the work is observable.
    expect(final?.toolCalls).toBe(1);
    expect(final?.edits).toBe(1);
    expect(final?.responseMessage).toMatchObject({
      text: 'Checked the workspace. The hash is 9f2c1d3e.',
      sender: 'OpenCode',
      isCreatedByUser: false,
    });
    expect(saved).toEqual([
      { text: PROMPT, isCreatedByUser: true },
      { text: 'Checked the workspace. The hash is 9f2c1d3e.', isCreatedByUser: false },
    ]);
  });
});
