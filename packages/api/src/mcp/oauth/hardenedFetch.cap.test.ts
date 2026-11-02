import { createHardenedOAuthFetch, resetHardenedOAuthFetchDispatchers } from './hardenedFetch';

jest.mock('~/auth', () => ({
  createSSRFSafeUndiciConnect: jest.fn(() => ({ lookup: jest.fn() })),
  isOAuthUrlAllowed: jest.fn(() => false),
  isSSRFTarget: jest.fn(() => false),
}));

describe('createHardenedOAuthFetch response cap', () => {
  const originalFetch = global.fetch;
  const mockFetch = jest.fn() as unknown as jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    resetHardenedOAuthFetchDispatchers();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('keeps a small OAuth document parseable for the SDK', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const response = await createHardenedOAuthFetch()('https://auth.example.com/token', {
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toEqual({ access_token: 'token' });
  });

  it('fails SDK parsing when the upstream body passes the cap', async () => {
    const chunk = new Uint8Array(64 * 1024).fill(32);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunk);
      },
    });
    mockFetch.mockResolvedValueOnce(
      new Response(stream, { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    const response = await createHardenedOAuthFetch()('https://auth.example.com/token', {
      method: 'POST',
    });

    await expect(response.json()).rejects.toThrow(/exceeded the size limit/);
  });
});
