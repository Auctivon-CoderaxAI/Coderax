import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import type { LoadedFreebuffSdk } from './adapter';
import type { EngineLimits } from '../types';
import {
  describeFreebuff,
  freebuffCapabilities,
  probeFreebuff,
  probeFreebuffTools,
  startFreebuffRun,
} from './adapter';

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

describe('Freebuff cloud execution', () => {
  const cloudModelId = 'nvidia/nemotron-3.5-lightning:free';
  const cloudKey = 'cloud-key-value-never-logged';
  const cloudBase = {
    enabled: true,
    cloud: {
      baseURL: 'https://openrouter.ai/api/v1',
      model: { providerId: 'openrouter', modelId: cloudModelId },
      apiKeyEnv: 'OPENROUTER_API_KEY',
    },
    env: { OPENROUTER_API_KEY: cloudKey },
    sdk,
    roots,
    mode: 'cloud' as const,
    limits,
  };
  const cloudFetch = (body: unknown = { data: [{ id: cloudModelId }] }) =>
    jest.fn(async (input: string) => {
      if (input.endsWith('/key')) {
        return response({ data: {} });
      }
      if (input.endsWith('/models')) {
        return response(body);
      }
      return response({}, 404);
    });

  it('is ready only for a catalogued $0 model with tool calling', () => {
    expect(describeFreebuff(cloudBase)).toEqual({ available: true, reason: 'ready' });
    expect(
      describeFreebuff({
        ...cloudBase,
        cloud: {
          ...cloudBase.cloud,
          model: { providerId: 'openrouter', modelId: 'deepseek/deepseek-r1' },
        },
      }),
    ).toMatchObject({ available: false, reason: 'not_configured' });
    expect(
      describeFreebuff({
        ...cloudBase,
        cloud: { ...cloudBase.cloud, baseURL: 'http://openrouter.ai/api/v1' },
      }),
    ).toMatchObject({ available: false, reason: 'not_configured' });
  });

  it('reports a missing credential without exposing a value', () => {
    const availability = describeFreebuff({ ...cloudBase, env: {} });
    expect(availability).toMatchObject({ available: false, reason: 'not_configured' });
    expect(JSON.stringify(availability)).toContain('OPENROUTER_API_KEY');
    expect(JSON.stringify(availability)).not.toContain(cloudKey);
  });

  it('verifies the key and checks free model availability', async () => {
    await expect(probeFreebuff({ ...cloudBase, fetchImpl: cloudFetch() })).resolves.toEqual({
      available: true,
      reason: 'ready',
    });
    await expect(
      probeFreebuff({ ...cloudBase, fetchImpl: cloudFetch({ data: [{ id: 'other:free' }] }) }),
    ).resolves.toMatchObject({ available: false, reason: 'model_missing' });
  });

  it.each([401, 403])(
    'rejects a key with status %s even when the model is listed',
    async (status) => {
      const fetchImpl = jest.fn(async (input: string) =>
        input.endsWith('/key')
          ? response({ error: cloudKey }, status)
          : response({
              data: [{ id: cloudModelId }],
            }),
      );
      await expect(probeFreebuff({ ...cloudBase, fetchImpl })).resolves.toEqual({
        available: false,
        reason: 'not_configured',
        detail: 'The cloud model credential was rejected.',
      });
      expect(fetchImpl).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/key',
        expect.objectContaining({ headers: { Authorization: `Bearer ${cloudKey}` } }),
      );
    },
  );

  it('proves native tool calling with a real tool-call probe', async () => {
    const fetchImpl = jest.fn(async (input: string, init?: { body?: string }) => {
      expect(input).toBe('https://openrouter.ai/api/v1/chat/completions');
      expect(init?.body).toContain('coderax_probe');
      return response({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: 'call-1',
                  type: 'function',
                  function: { name: 'coderax_probe', arguments: '{}' },
                },
              ],
            },
          },
        ],
      });
    });
    await expect(probeFreebuffTools(cloudBase, { fetchImpl })).resolves.toEqual({
      available: true,
      reason: 'ready',
    });

    const textOnly = jest.fn(async () =>
      response({ choices: [{ message: { content: 'no tool call' } }] }),
    );
    await expect(probeFreebuffTools(cloudBase, { fetchImpl: textOnly })).resolves.toMatchObject({
      available: false,
      reason: 'not_configured',
    });
  });

  it('starts a cloud run with the server credential and no key in its events', async () => {
    const privateRoot = await mkdtemp(path.join(os.tmpdir(), 'coderax-cloud-private-'));
    const cloudRoot = await mkdtemp(path.join(os.tmpdir(), 'coderax-cloud-run-'));
    let byok: Record<string, unknown> | null = null;
    class CloudClient {
      constructor(options: { byok: Record<string, unknown> }) {
        byok = options.byok;
      }

      run = jest.fn(async (options: { handleStreamChunk: (chunk: string) => void }) => {
        options.handleStreamChunk('CLOUD_AGENT_OK');
        return { output: { type: 'last_message', value: 'CLOUD_AGENT_OK' } };
      });
    }
    const cloudSdk: LoadedFreebuffSdk = {
      module: {
        ...sdk.module,
        CodebuffClient: CloudClient as unknown as LoadedFreebuffSdk['module']['CodebuffClient'],
      },
    };
    try {
      const started = await startFreebuffRun(
        {
          ...cloudBase,
          sdk: cloudSdk,
          roots: { private: privateRoot, cloud: cloudRoot },
          fetchImpl: cloudFetch(),
        },
        {
          taskKey: 'task',
          conversationId: 'conversation',
          prompt: 'Reply with CLOUD_AGENT_OK.',
          mode: 'cloud',
          workspaceRoot: cloudRoot,
        },
      );
      expect(started.ok).toBe(true);
      if (!started.ok) {
        return;
      }
      const events = [];
      for await (const event of started.value.events) {
        events.push(event);
      }
      await started.value.result;
      expect(JSON.stringify(events)).toContain('CLOUD_AGENT_OK');
      expect(JSON.stringify(events)).not.toContain(cloudKey);
      expect(byok).toMatchObject({
        provider: 'openrouter',
        model: cloudModelId,
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: cloudKey,
      });
    } finally {
      await rm(privateRoot, { recursive: true, force: true });
      await rm(cloudRoot, { recursive: true, force: true });
    }
  });

  it('refuses a run whose data mode does not match the engine mode', async () => {
    const started = await startFreebuffRun(cloudBase, {
      taskKey: 'task',
      conversationId: 'conversation',
      prompt: 'Do work.',
      mode: 'private',
      workspaceRoot: '/srv/coderax/private',
    });
    expect(started.ok).toBe(false);
    if (!started.ok) {
      expect(started.error.code).toBe('not_configured');
    }
  });

  it('confines a cloud run to the cloud workspace root', async () => {
    const privateRoot = await mkdtemp(path.join(os.tmpdir(), 'coderax-confine-private-'));
    const cloudRoot = await mkdtemp(path.join(os.tmpdir(), 'coderax-confine-cloud-'));
    const outside = await mkdtemp(path.join(os.tmpdir(), 'coderax-confine-outside-'));
    try {
      const started = await startFreebuffRun(
        {
          ...cloudBase,
          roots: { private: privateRoot, cloud: cloudRoot },
          fetchImpl: cloudFetch(),
        },
        {
          taskKey: 'task',
          conversationId: 'conversation',
          prompt: 'Do work.',
          mode: 'cloud',
          workspaceRoot: outside,
        },
      );
      expect(started.ok).toBe(false);
      if (!started.ok) {
        expect(started.error.code).toBe('workspace_denied');
      }
    } finally {
      await rm(privateRoot, { recursive: true, force: true });
      await rm(cloudRoot, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
