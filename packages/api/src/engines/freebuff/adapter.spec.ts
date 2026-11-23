import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import type { LoadedFreebuffSdk } from './adapter';
import type { EngineLimits } from '../types';
import { describeFreebuff, freebuffCapabilities, probeFreebuff, startFreebuffRun } from './adapter';

const limits: EngineLimits = { timeoutMs: 1_000, maxSummaryChars: 100 };
const roots = { private: '/srv/coderax/private', cloud: '/srv/coderax/cloud' };

class FakeClient {
  run = jest.fn();
}

const sdk: LoadedFreebuffSdk = {
  module: {
    CodebuffClient: FakeClient as unknown as LoadedFreebuffSdk['module']['CodebuffClient'],
    normalizeByokBaseUrl: () => undefined,
    isUntrustedAgentPublisherError: () => false,
  },
};

const response = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const probeFetch = jest.fn(async (input: string) => {
  if (input.endsWith('/api/tags')) {
    return response({ models: [{ name: 'qwen2.5-coder:7b' }] });
  }
  if (input.endsWith('/api/show')) {
    return response({ parameters: 'num_ctx 16384' });
  }
  return response({}, 404);
});

const base = {
  enabled: true,
  baseURL: 'http://127.0.0.1:11434/v1',
  model: { providerId: 'ollama', modelId: 'qwen2.5-coder:7b' },
  sdk,
  roots,
  mode: 'private' as const,
  limits,
  fetchImpl: probeFetch,
};

describe('Freebuff engine adapter', () => {
  it('stays disabled until the owner opts in', () => {
    expect(describeFreebuff({ ...base, enabled: false })).toEqual(
      expect.objectContaining({ available: false, reason: 'disabled' }),
    );
  });

  it('requires an endpoint, a local model and a private root', () => {
    expect(describeFreebuff({ ...base, model: null })).toEqual(
      expect.objectContaining({ available: false, reason: 'not_configured' }),
    );
    expect(describeFreebuff({ ...base, roots: { private: '', cloud: '' } })).toEqual(
      expect.objectContaining({ available: false, reason: 'not_configured' }),
    );
  });

  it('refuses a hosted model endpoint', () => {
    expect(describeFreebuff({ ...base, baseURL: 'https://api.example.com/v1' })).toEqual(
      expect.objectContaining({ available: false, reason: 'not_configured' }),
    );
  });

  it('allows an explicitly configured private host', () => {
    expect(
      describeFreebuff({
        ...base,
        baseURL: 'http://host.docker.internal:11434/v1',
        allowedHosts: ['host.docker.internal'],
      }),
    ).toEqual({ available: true, reason: 'ready' });
    expect(
      describeFreebuff({
        ...base,
        baseURL: 'http://ollama:11434/v1',
        allowedHosts: ['OLLAMA'],
      }),
    ).toEqual({ available: true, reason: 'ready' });
  });

  it('refuses a private host that is not explicitly allowed', () => {
    expect(describeFreebuff({ ...base, baseURL: 'http://host.docker.internal:11434/v1' })).toEqual(
      expect.objectContaining({ available: false, reason: 'not_configured' }),
    );
    expect(
      describeFreebuff({
        ...base,
        baseURL: 'http://other.internal:11434/v1',
        allowedHosts: ['host.docker.internal'],
      }),
    ).toEqual(expect.objectContaining({ available: false, reason: 'not_configured' }));
  });

  it('keeps the endpoint restrictions for an allowed host', () => {
    for (const baseURL of [
      'https://host.docker.internal:11434/v1',
      'http://user:pass@host.docker.internal:11434/v1',
      'http://host.docker.internal:11434/v1?x=1',
      'http://host.docker.internal:11434/v1#x',
      'http://host.docker.internal.evil.example:11434/v1',
    ]) {
      expect(
        describeFreebuff({ ...base, baseURL, allowedHosts: ['host.docker.internal'] }),
      ).toEqual(expect.objectContaining({ available: false, reason: 'not_configured' }));
    }
  });

  it('refuses a cloud-backed ollama model', () => {
    expect(
      describeFreebuff({ ...base, model: { providerId: 'ollama', modelId: 'gpt-oss:cloud' } }),
    ).toEqual(expect.objectContaining({ available: false, reason: 'not_configured' }));
  });

  it('refuses a hosted model provider', () => {
    expect(
      describeFreebuff({ ...base, model: { providerId: 'opencode', modelId: 'big-pickle' } }),
    ).toEqual(expect.objectContaining({ available: false, reason: 'not_configured' }));
  });

  it('reports the SDK as unavailable instead of running without it', () => {
    expect(describeFreebuff({ ...base, sdk: null })).toEqual(
      expect.objectContaining({ available: false, reason: 'sdk_unavailable' }),
    );
  });

  it('is ready when every prerequisite is present', () => {
    expect(describeFreebuff(base)).toEqual({ available: true, reason: 'ready' });
    expect(freebuffCapabilities).toEqual(
      expect.objectContaining({ streaming: true, tools: true, cancellation: true }),
    );
  });

  it('probes the Ollama model and its declared 16k context', async () => {
    await expect(probeFreebuff(base)).resolves.toEqual({ available: true, reason: 'ready' });
  });

  it('reports a model that is not installed', async () => {
    const fetchImpl = jest.fn(async (input: string) => {
      expect(input).toContain('/api/tags');
      return response({ models: [{ name: 'other:latest' }] });
    });

    await expect(probeFreebuff({ ...base, fetchImpl })).resolves.toMatchObject({
      available: false,
      reason: 'model_missing',
    });
  });

  it('reports a model whose declared context is below 16k', async () => {
    const fetchImpl = jest.fn(async (input: string) => {
      if (input.endsWith('/api/tags')) {
        return response({ models: [{ name: 'qwen2.5-coder:7b' }] });
      }
      return response({ parameters: 'num_ctx 8192' });
    });

    await expect(probeFreebuff({ ...base, fetchImpl })).resolves.toMatchObject({
      available: false,
      reason: 'context_too_small',
    });
  });

  it('fails closed when Ollama does not declare num_ctx', async () => {
    const fetchImpl = jest.fn(async (input: string) => {
      if (input.endsWith('/api/tags')) {
        return response({ models: [{ name: 'qwen2.5-coder:7b' }] });
      }
      return response({ parameters: 'stop <|im_end|>' });
    });

    await expect(probeFreebuff({ ...base, fetchImpl })).resolves.toMatchObject({
      available: false,
      reason: 'context_unavailable',
    });
  });

  it('reports an unreachable model endpoint as server_unavailable', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('ECONNREFUSED with a secret-looking detail');
    });

    const probed = await probeFreebuff({ ...base, fetchImpl });
    expect(probed).toMatchObject({ available: false, reason: 'server_unavailable' });
    expect(JSON.stringify(probed)).not.toContain('ECONNREFUSED');
  });

  it('fails closed before starting a run without the SDK', async () => {
    const started = await startFreebuffRun(
      { ...base, sdk: null },
      {
        taskKey: 'task',
        conversationId: 'conversation',
        prompt: 'Fix the failing test.',
        mode: 'private',
        workspaceRoot: '/srv/coderax/private',
      },
    );
    expect(started.ok).toBe(false);
    if (!started.ok) {
      expect(started.error.code).toBe('sdk_unavailable');
    }
  });

  it('emits each reply token once when the SDK reports chunks and text events', async () => {
    const privateRoot = await mkdtemp(path.join(os.tmpdir(), 'coderax-freebuff-'));
    const cloudRoot = await mkdtemp(path.join(os.tmpdir(), 'coderax-freebuff-cloud-'));
    const run = jest.fn(
      async (options: {
        handleStreamChunk: (chunk: string) => void;
        handleEvent: (event: unknown) => void;
      }) => {
        options.handleStreamChunk('FREE');
        options.handleStreamChunk('BUFF_OK');
        options.handleEvent({ type: 'text', text: 'FREEBUFF_OK' });
        return { output: { type: 'last_message', value: 'FREEBUFF_OK' } };
      },
    );
    class CapturingClient {
      run = run;
    }
    const sdkWithRun: LoadedFreebuffSdk = {
      module: {
        ...sdk.module,
        CodebuffClient: CapturingClient as unknown as LoadedFreebuffSdk['module']['CodebuffClient'],
      },
    };

    try {
      const started = await startFreebuffRun(
        { ...base, sdk: sdkWithRun, roots: { private: privateRoot, cloud: cloudRoot } },
        {
          taskKey: 'task',
          conversationId: 'conversation',
          prompt: 'Reply with FREEBUFF_OK.',
          mode: 'private',
          workspaceRoot: privateRoot,
        },
      );
      expect(started.ok).toBe(true);
      if (!started.ok) {
        return;
      }

      const text: string[] = [];
      for await (const event of started.value.events) {
        if (event.type === 'text_delta') {
          text.push(event.text);
        }
      }
      await started.value.result;
      expect(text.join('')).toBe('FREEBUFF_OK');
    } finally {
      await rm(privateRoot, { recursive: true, force: true });
      await rm(cloudRoot, { recursive: true, force: true });
    }
  });

  it('starts against an explicitly allowed private endpoint', async () => {
    const privateRoot = await mkdtemp(path.join(os.tmpdir(), 'coderax-freebuff-allowed-'));
    const cloudRoot = await mkdtemp(path.join(os.tmpdir(), 'coderax-freebuff-allowed-cloud-'));
    class AllowedHostClient {
      run = jest.fn(async () => ({ output: { type: 'last_message', value: 'OK' } }));
    }
    const allowedSdk: LoadedFreebuffSdk = {
      module: {
        ...sdk.module,
        CodebuffClient:
          AllowedHostClient as unknown as LoadedFreebuffSdk['module']['CodebuffClient'],
      },
    };

    try {
      const started = await startFreebuffRun(
        {
          ...base,
          baseURL: 'http://host.docker.internal:11434/v1',
          allowedHosts: ['host.docker.internal'],
          sdk: allowedSdk,
          roots: { private: privateRoot, cloud: cloudRoot },
        },
        {
          taskKey: 'task',
          conversationId: 'conversation',
          prompt: 'Reply with OK.',
          mode: 'private',
          workspaceRoot: privateRoot,
        },
      );
      expect(started.ok).toBe(true);
      if (started.ok) {
        await started.value.result;
      }
    } finally {
      await rm(privateRoot, { recursive: true, force: true });
      await rm(cloudRoot, { recursive: true, force: true });
    }
  });

  it('requires a task prompt', async () => {
    const started = await startFreebuffRun(base, {
      taskKey: 'task',
      conversationId: 'conversation',
      prompt: '   ',
      mode: 'private',
      workspaceRoot: '/srv/coderax/private',
    });
    expect(started.ok).toBe(false);
    if (!started.ok) {
      expect(started.error.code).toBe('protocol_error');
    }
  });
});
