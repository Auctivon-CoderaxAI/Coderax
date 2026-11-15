import { createModelGatewayStudioGenerator, createModelGatewayStudioGeneratorFromEnv } from './modelGateway';
import { StudioGenerationError } from './types';
import type { StudioGenerationRequest } from './types';

const project = {
  title: 'Demo',
  entry: 'index.html',
  files: [{ path: 'index.html', content: '<!doctype html><title>Demo</title>' }],
};

function request(): StudioGenerationRequest {
  return {
    prompt: 'make a demo page',
    userId: 'private-user-id',
    tenantId: 'private-tenant-id',
    signal: new AbortController().signal,
  };
}

function reply(content: string, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });
}

describe('ModelGateway Studio generator', () => {
  it('sends only the prompt to the configured OpenAI-compatible gateway', async () => {
    const fetchMock = jest.fn().mockResolvedValue(reply(JSON.stringify(project)));
    const input = request();
    const generator = createModelGatewayStudioGenerator({
      baseUrl: 'https://gateway.example.test/v1/',
      apiKey: 'server-only-key',
      model: 'local-model',
      fetch: fetchMock as unknown as typeof fetch,
    });

    await expect(generator.generate(input)).resolves.toEqual(project);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://gateway.example.test/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer server-only-key' }),
        signal: expect.any(AbortSignal),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.model).toBe('local-model');
    expect(body.messages[1]).toEqual({ role: 'user', content: input.prompt });
    expect(JSON.stringify(body)).not.toContain(input.userId);
    expect(JSON.stringify(body)).not.toContain(input.tenantId);
  });

  it('accepts one fenced JSON response', async () => {
    const fetchMock = jest.fn().mockResolvedValue(reply(`\`\`\`json\n${JSON.stringify(project)}\n\`\`\``));
    const generator = createModelGatewayStudioGenerator({
      baseUrl: 'https://gateway.example.test/v1',
      model: 'local-model',
      fetch: fetchMock as unknown as typeof fetch,
    });

    await expect(generator.generate(request())).resolves.toEqual(project);
  });

  it('maps non-JSON model output to INVALID_OUTPUT', async () => {
    const fetchMock = jest.fn().mockResolvedValue(reply('sure! here you go'));
    const generator = createModelGatewayStudioGenerator({
      baseUrl: 'https://gateway.example.test/v1',
      model: 'local-model',
      fetch: fetchMock as unknown as typeof fetch,
    });

    await expect(generator.generate(request())).rejects.toMatchObject({ code: 'INVALID_OUTPUT' });
  });

  it('maps oversized and malformed gateway responses to stable errors', async () => {
    const oversizedFetch = jest.fn().mockResolvedValue(reply('x'.repeat(64)));
    const oversized = createModelGatewayStudioGenerator({
      baseUrl: 'https://gateway.example.test/v1',
      model: 'local-model',
      fetch: oversizedFetch as unknown as typeof fetch,
      maxResponseBytes: 16,
    });
    await expect(oversized.generate(request())).rejects.toMatchObject({ code: 'INVALID_OUTPUT' });

    const malformedFetch = jest.fn().mockResolvedValue(new Response('not-json'));
    const malformed = createModelGatewayStudioGenerator({
      baseUrl: 'https://gateway.example.test/v1',
      model: 'local-model',
      fetch: malformedFetch as unknown as typeof fetch,
    });
    await expect(malformed.generate(request())).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
  });

  it('maps HTTP and network failures to UPSTREAM_ERROR without returning upstream text', async () => {
    const failing = jest.fn().mockResolvedValue(new Response('private upstream detail', { status: 500 }));
    const generator = createModelGatewayStudioGenerator({
      baseUrl: 'https://gateway.example.test/v1',
      model: 'local-model',
      fetch: failing as unknown as typeof fetch,
    });
    await expect(generator.generate(request())).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });

    const throwing = jest.fn().mockRejectedValue(new Error('private socket detail'));
    const networkFailure = createModelGatewayStudioGenerator({
      baseUrl: 'https://gateway.example.test/v1',
      model: 'local-model',
      fetch: throwing as unknown as typeof fetch,
    });
    await expect(networkFailure.generate(request())).rejects.toBeInstanceOf(StudioGenerationError);
    await expect(networkFailure.generate(request())).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
  });

  it('is not configured without both URL and model', () => {
    expect(createModelGatewayStudioGeneratorFromEnv({})).toBeNull();
    expect(
      createModelGatewayStudioGeneratorFromEnv({
        STUDIO_MODEL_GATEWAY_URL: 'https://gateway.example.test/v1',
        STUDIO_MODEL: 'local-model',
      }),
    ).not.toBeNull();
  });
});
