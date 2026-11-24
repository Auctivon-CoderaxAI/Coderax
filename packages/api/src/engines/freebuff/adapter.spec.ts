import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import type { FreebuffAdapterOptions, LoadedFreebuffSdk } from './adapter';
import type { EngineLimits } from '../types';
import {
  createFreebuffAdapter,
  describeFreebuff,
  freebuffCapabilities,
  probeFreebuff,
  startFreebuffRun,
} from './adapter';
import { createEngineRegistry } from '../registry';

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

  it('never reports an allowlisted non-loopback endpoint as ready', () => {
    const result = describeFreebuff({
      ...base,
      baseURL: 'http://host.docker.internal:11434/v1',
      allowedHosts: ['host.docker.internal'],
    });
    expect(result).toEqual(
      expect.objectContaining({
        available: false,
        reason: 'not_configured',
        detail: expect.stringContaining(
          'rejected even when listed in engines.freebuff.allowedHosts',
        ),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        detail: expect.not.stringContaining('host.docker.internal'),
      }),
    );
    expect(
      describeFreebuff({
        ...base,
        baseURL: 'http://ollama:11434/v1',
        allowedHosts: ['OLLAMA'],
      }),
    ).toEqual(
      expect.objectContaining({
        available: false,
        reason: 'not_configured',
        detail: expect.stringContaining('loopback'),
      }),
    );
  });

  it('refuses every non-loopback host, allowlisted or not', () => {
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

  it('keeps the endpoint restrictions', () => {
    for (const baseURL of [
      'https://127.0.0.1:11434/v1',
      'http://user:pass@127.0.0.1:11434/v1',
      'http://127.0.0.1:11434/v1?x=1',
      'http://127.0.0.1:11434/v1#x',
      'http://127.0.0.1.evil.example:11434/v1',
    ]) {
      expect(describeFreebuff({ ...base, baseURL })).toEqual(
        expect.objectContaining({ available: false, reason: 'not_configured' }),
      );
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

  it('applies the private model gate only in private mode', () => {
    const hostedFreeModel = { providerId: 'opencode', modelId: 'deepseek-v4.1-flash-free' };
    const bothRoots = { private: '/srv/coderax/private', cloud: '/srv/coderax/cloud' };

    expect(
      describeFreebuff({ ...base, roots: bothRoots, model: hostedFreeModel, mode: 'private' }),
    ).toEqual(expect.objectContaining({ available: false, reason: 'not_configured' }));
    expect(
      describeFreebuff({ ...base, roots: bothRoots, model: hostedFreeModel, mode: 'cloud' }),
    ).toEqual({ available: true, reason: 'ready' });
  });

  it('requires the workspace root for the configured mode', () => {
    expect(
      describeFreebuff({
        ...base,
        mode: 'cloud',
        roots: { private: '/srv/coderax/private', cloud: '' },
      }),
    ).toEqual(expect.objectContaining({ available: false, reason: 'not_configured' }));
    expect(
      describeFreebuff({
        ...base,
        mode: 'private',
        roots: { private: '', cloud: '/srv/coderax/cloud' },
      }),
    ).toEqual(expect.objectContaining({ available: false, reason: 'not_configured' }));
  });

  it('names the configured mode in the message that reports a missing root', () => {
    const unavailable = describeFreebuff({
      ...base,
      mode: 'cloud',
      roots: { private: '/srv/coderax/private', cloud: '' },
    });
    expect(unavailable.available).toBe(false);
    if (!unavailable.available) {
      expect(unavailable.detail).toContain('engines.workspaces.cloudRoot');
    }
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

  it.each(['ollama', 'lmstudio'])(
    'authenticates every %s discovery request',
    async (providerId) => {
      const env = jest.replaceProperty(process, 'env', {
        ...process.env,
        FREEBUFF_LOCAL_API_KEY: ' test-key ',
      });
      const fetchImpl: NonNullable<FreebuffAdapterOptions['fetchImpl']> = async (input, init) => {
        if (init?.headers?.authorization !== 'Bearer test-key' || init.redirect !== 'error') {
          return response({}, 401);
        }
        return input.endsWith('/models')
          ? response({ data: [{ id: base.model.modelId }] })
          : probeFetch(input);
      };
      try {
        await expect(
          probeFreebuff({ ...base, model: { ...base.model, providerId }, fetchImpl }),
        ).resolves.toEqual({ available: true, reason: 'ready' });
      } finally {
        env.restore();
      }
    },
  );

  it('recovers on the next start and reports subsequent start failures in the snapshot', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'coderax-freebuff-'));
    let online = false;
    const adapter = createFreebuffAdapter({
      ...base,
      roots: { ...roots, private: root },
      fetchImpl: async (input) => (online ? probeFetch(input) : response({}, 503)),
    });
    const registry = createEngineRegistry({
      defaultEngine: 'freebuff',
      adapters: { freebuff: adapter },
    });
    const request = {
      taskKey: 'task',
      conversationId: 'conversation',
      prompt: 'Run',
      mode: 'private' as const,
      workspaceRoot: root,
    };
    try {
      await registry.probe();
      expect(registry.snapshot().engines[0]?.availability.reason).toBe('server_unavailable');
      online = true;
      const started = await registry.start({ request });
      expect(started.ok).toBe(true);
      if (started.ok) {
        await started.value.close();
      }
      expect(registry.snapshot().engines[0]?.availability.reason).toBe('ready');
      online = false;
      await expect(registry.start({ request })).resolves.toMatchObject({
        ok: false,
        error: { code: 'server_unavailable' },
      });
      expect(registry.snapshot().engines[0]?.availability.reason).toBe('server_unavailable');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('skips discovery on pre-abort and cancels in-flight discovery without caching an outage', async () => {
    const fetchImpl = jest.fn<
      ReturnType<NonNullable<FreebuffAdapterOptions['fetchImpl']>>,
      Parameters<NonNullable<FreebuffAdapterOptions['fetchImpl']>>
    >(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
            once: true,
          });
        }),
    );
    const adapter = createFreebuffAdapter({ ...base, fetchImpl });
    const request = {
      taskKey: 'task',
      conversationId: 'conversation',
      prompt: 'Run',
      mode: 'private' as const,
      workspaceRoot: roots.private,
    };
    const cancelled = { ok: false, error: { code: 'cancelled' } };
    await expect(adapter.start({ ...request, signal: AbortSignal.abort() })).resolves.toMatchObject(
      cancelled,
    );
    expect(fetchImpl).not.toHaveBeenCalled();

    const controller = new AbortController();
    const started = adapter.start({ ...request, signal: controller.signal });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const probeSignal = fetchImpl.mock.calls[0]?.[1]?.signal;
    controller.abort();
    expect(probeSignal?.aborted).toBe(true);
    await expect(started).resolves.toMatchObject(cancelled);
    expect(adapter.describe()).toEqual({ available: true, reason: 'ready' });
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

  it('fails closed for an allowlisted non-loopback endpoint', async () => {
    const started = await startFreebuffRun(
      {
        ...base,
        baseURL: 'http://host.docker.internal:11434/v1',
        allowedHosts: ['host.docker.internal'],
      },
      {
        taskKey: 'task',
        conversationId: 'conversation',
        prompt: 'Reply with OK.',
        mode: 'private',
        workspaceRoot: '/srv/coderax/private',
      },
    );
    expect(started.ok).toBe(false);
    if (!started.ok) {
      expect(started.error.code).toBe('not_configured');
      expect(started.error.message).toContain('allowedHosts');
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
