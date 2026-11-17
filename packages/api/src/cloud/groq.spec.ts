import type { GroqConfig, GroqMessage, GroqRequest } from './groq';
import { createGroqProvider, createMemoryGroqLedger, GROQ_FREE_MODEL } from './groq';

const config = (overrides: Partial<GroqConfig> = {}): GroqConfig => ({
  enabled: true,
  acknowledgeFreeTierOnly: true,
  model: GROQ_FREE_MODEL,
  maxRequestsPerDay: 200,
  maxTokensPerDay: 200_000,
  requestTimeoutMs: 5_000,
  ...overrides,
});

const messages: GroqMessage[] = [{ role: 'user', content: 'Write a haiku about tests.' }];

const request = (overrides: Partial<GroqRequest> = {}): GroqRequest => ({
  mode: 'cloud',
  approved: true,
  messages,
  ...overrides,
});

const okResponse = (text = 'Green test, calm mind') =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: text } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

function provider(
  overrides: {
    config?: Partial<GroqConfig>;
    env?: Record<string, string | undefined>;
    fetchImpl?: unknown;
    ledger?: ReturnType<typeof createMemoryGroqLedger>;
  } = {},
) {
  const fetchImpl = (overrides.fetchImpl ??
    jest.fn(async () => okResponse())) as unknown as typeof fetch;
  return createGroqProvider({
    config: config(overrides.config),
    env: { GROQ_API_KEY: 'gsk_test_key_value_1234567890', ...overrides.env },
    fetchImpl,
    ...(overrides.ledger ? { ledger: overrides.ledger } : {}),
  });
}

describe('GroqCloud free-tier provider', () => {
  it('fails closed when disabled, uncredentialed or unattested', async () => {
    const fetchImpl = jest.fn();
    const disabled = provider({ config: { enabled: false }, fetchImpl });
    await expect(disabled.complete(request())).resolves.toEqual(
      expect.objectContaining({ ok: false, error: expect.objectContaining({ code: 'disabled' }) }),
    );

    const noKey = provider({ env: { GROQ_API_KEY: undefined }, fetchImpl });
    await expect(noKey.complete(request())).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: 'missing_credential' }),
      }),
    );

    const unattested = provider({ config: { acknowledgeFreeTierOnly: false }, fetchImpl });
    await expect(unattested.complete(request())).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: 'billing_tier_unattested' }),
      }),
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never sends private mode content, even when everything else is approved', async () => {
    const fetchImpl = jest.fn();
    const groq = provider({ fetchImpl });
    await expect(groq.complete(request({ mode: 'private' }))).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: 'private_mode_denied' }),
      }),
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('requires an explicit approval before any request', async () => {
    const fetchImpl = jest.fn();
    const groq = provider({ fetchImpl });
    await expect(groq.complete(request({ approved: false }))).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: 'export_not_approved' }),
      }),
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('allows only the verified free model and refuses tool definitions', async () => {
    const fetchImpl = jest.fn();
    const wrongModel = provider({
      config: { model: 'llama-3.3-70b-versatile' },
      fetchImpl,
    });
    await expect(wrongModel.complete(request())).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: 'model_not_allowlisted' }),
      }),
    );

    const withTools = provider({ fetchImpl });
    await expect(withTools.complete(request({ tools: [{ type: 'function' }] }))).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: 'tools_not_allowed' }),
      }),
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('stops without retrying when the free quota is exhausted', async () => {
    const fetchImpl = jest.fn(async () => new Response('{}', { status: 429 }));
    const groq = provider({ fetchImpl });
    const result = await groq.complete(request());

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: 'quota_exhausted', retryable: false }),
      }),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('enforces the local daily request budget before calling the provider', async () => {
    const fetchImpl = jest.fn(async () => okResponse());
    const groq = provider({
      config: { maxRequestsPerDay: 1, maxTokensPerDay: 10_000 },
      fetchImpl,
    });

    await expect(groq.complete(request())).resolves.toEqual(expect.objectContaining({ ok: true }));
    await expect(groq.complete(request())).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: 'quota_exhausted' }),
      }),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('scrubs a server credential out of the outgoing messages', async () => {
    let body = '';
    const fetchImpl = jest.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      body = String(init?.body ?? '');
      return okResponse();
    }) as unknown as typeof fetch;

    const groq = provider({
      fetchImpl,
      env: { GROQ_API_KEY: 'gsk_live_secret_value_123456' },
    });
    const result = await groq.complete(
      request({
        messages: [
          {
            role: 'user',
            content: 'Here is my key gsk_live_secret_value_123456, explain it.',
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    expect(body).not.toContain('gsk_live_secret_value_123456');
    expect(body).toContain('[REDACTED]');
  });

  it('streams SSE chunks and reports usage', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode('data: {"choices":[{"delta":{"content":"Green "}}],"usage":null}\n\n'),
        );
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"content":"tests"}}],"usage":{"total_tokens":12}}\n\n',
          ),
        );
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    const fetchImpl = jest.fn(
      async () => new Response(stream, { status: 200 }),
    ) as unknown as typeof fetch;

    const deltas: string[] = [];
    const groq = provider({ fetchImpl });
    const result = await groq.stream(request(), (delta) => deltas.push(delta));

    expect(deltas).toEqual(['Green ', 'tests']);
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        value: expect.objectContaining({ text: 'Green tests' }),
      }),
    );
  });

  it('reports status without the key and never falls back to a paid model', () => {
    const groq = provider();
    const status = groq.status();
    expect(status).toEqual(
      expect.objectContaining({
        provider: 'groq',
        model: GROQ_FREE_MODEL,
        freeTierOnly: true,
        credentialPresent: true,
      }),
    );
    expect(JSON.stringify(status)).not.toContain('gsk_test_key_value_1234567890');
  });

  it('keeps an unknown-usage reservation instead of refunding it', () => {
    const ledger = createMemoryGroqLedger({ maxRequestsPerDay: 2, maxTokensPerDay: 100 }, () => 0);
    expect(ledger.reserve({ requests: 1, tokens: 40 })).toBe(true);
    ledger.settle({ reservedTokens: 40 });
    expect(ledger.snapshot().tokens).toBe(40);
    expect(ledger.reserve({ requests: 1, tokens: 70 })).toBe(false);
  });
});
