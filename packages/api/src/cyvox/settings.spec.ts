import {
  buildCyvoxConnectionStatus,
  normalizeCyvoxBaseUrl,
  parseApiVersion,
  parseCapabilities,
  resolveCyvoxTarget,
  toProbeRecord,
  verifyCyvoxEndpoint,
} from './settings';

const environmentOff = { enabled: false };

describe('normalizeCyvoxBaseUrl', () => {
  it('accepts https origins and loopback http', () => {
    expect(normalizeCyvoxBaseUrl('https://cyvox.example.com')?.origin).toBe(
      'https://cyvox.example.com',
    );
    expect(normalizeCyvoxBaseUrl('http://127.0.0.1:18000')?.origin).toBe('http://127.0.0.1:18000');
  });

  it.each([
    'http://cyvox.example.com',
    'https://cyvox.example.com/api',
    'https://cyvox.example.com?x=1',
    'https://user:pass@cyvox.example.com',
    'ftp://cyvox.example.com',
    'not a url',
  ])('rejects %s', (value) => {
    expect(normalizeCyvoxBaseUrl(value)).toBeNull();
  });
});

describe('resolveCyvoxTarget', () => {
  it('uses environment configuration when nothing is stored', () => {
    expect(
      resolveCyvoxTarget({
        environment: {
          enabled: true,
          baseUrl: 'https://cyvox.example.com',
          authToken: 'env-token',
        },
      }),
    ).toMatchObject({ source: 'environment', authToken: 'env-token' });
  });

  it('does not use the environment when it is disabled', () => {
    expect(
      resolveCyvoxTarget({
        environment: {
          enabled: false,
          baseUrl: 'https://cyvox.example.com',
          authToken: 'env-token',
        },
      }),
    ).toBeNull();
  });

  it('prefers a stored connection over the environment', () => {
    const target = resolveCyvoxTarget({
      stored: { enabled: true, baseUrl: 'https://stored.example.com', authToken: 'stored-token' },
      environment: {
        enabled: true,
        baseUrl: 'https://cyvox.example.com',
        authToken: 'env-token',
      },
    });
    expect(target?.url.origin).toBe('https://stored.example.com');
    expect(target?.authToken).toBe('stored-token');
    expect(target?.source).toBe('settings');
  });

  it('keeps a stored connection disabled even when the environment is enabled', () => {
    expect(
      resolveCyvoxTarget({
        stored: {
          enabled: false,
          baseUrl: 'https://stored.example.com',
          authToken: 'stored-token',
        },
        environment: {
          enabled: true,
          baseUrl: 'https://cyvox.example.com',
          authToken: 'env-token',
        },
      }),
    ).toBeNull();
  });

  it('rejects a remote stored connection without a token', () => {
    expect(
      resolveCyvoxTarget({
        stored: { enabled: true, baseUrl: 'https://stored.example.com' },
        environment: environmentOff,
      }),
    ).toBeNull();
  });

  it('allows a loopback connection without a token', () => {
    expect(
      resolveCyvoxTarget({
        stored: { enabled: true, baseUrl: 'http://localhost:18000' },
        environment: environmentOff,
      }),
    ).toMatchObject({ source: 'settings' });
  });
});

describe('buildCyvoxConnectionStatus', () => {
  it('reports an unconfigured integration without leaking a token', () => {
    expect(buildCyvoxConnectionStatus({ environment: environmentOff })).toEqual({
      configured: false,
      enabled: false,
      source: 'none',
      baseUrl: undefined,
      tokenConfigured: false,
      tokenPreview: undefined,
      updatedAt: undefined,
    });
  });

  it('reports the stored source, masked preview and enabled state', () => {
    expect(
      buildCyvoxConnectionStatus({
        stored: {
          enabled: true,
          baseUrl: 'https://cyvox.example.com',
          authToken: 'stored-token',
          authTokenPreview: 'stored...oken',
        },
        environment: environmentOff,
      }),
    ).toMatchObject({
      configured: true,
      enabled: true,
      source: 'settings',
      baseUrl: 'https://cyvox.example.com',
      tokenConfigured: true,
      tokenPreview: 'stored...oken',
    });
  });

  it('marks an environment connection as configured but not editable from settings', () => {
    expect(
      buildCyvoxConnectionStatus({
        environment: {
          enabled: true,
          baseUrl: 'https://cyvox.example.com',
          authToken: 'env-token',
        },
      }),
    ).toMatchObject({ configured: true, enabled: true, source: 'environment' });
  });
});

describe('parseCapabilities', () => {
  it('reads names, objects and a nested item list', () => {
    expect(parseCapabilities({ capabilities: ['browser', 'shell'] })).toEqual(['browser', 'shell']);
    expect(parseCapabilities({ capabilities: [{ name: 'browser' }, { id: 'shell' }] })).toEqual([
      'browser',
      'shell',
    ]);
    expect(parseCapabilities({ capabilities: { items: ['browser'] } })).toEqual(['browser']);
  });

  it('deduplicates, drops unreadable entries and bounds the list', () => {
    expect(parseCapabilities({ capabilities: ['a', 'a', 5, null] })).toEqual(['a']);
    const many = Array.from({ length: 80 }, (_, index) => `cap-${index}`);
    expect(parseCapabilities({ capabilities: many })).toHaveLength(50);
  });

  it('returns nothing when the service reports no capabilities', () => {
    expect(parseCapabilities({ summary: 'ok' })).toEqual([]);
    expect(parseCapabilities(null)).toEqual([]);
  });
});

describe('parseApiVersion', () => {
  it.each([
    [{ api_version: '1.4.0' }, '1.4.0'],
    [{ version: '2.0' }, '2.0'],
    [{ build: { version: '3.1' } }, '3.1'],
  ])('reads the version from %j', (payload, expected) => {
    expect(parseApiVersion(payload)).toBe(expected);
  });

  it('returns undefined when no version is advertised', () => {
    expect(parseApiVersion({ summary: 'ok' })).toBeUndefined();
  });
});

describe('verifyCyvoxEndpoint', () => {
  const originalFetch = global.fetch;
  const target = {
    url: new URL('https://cyvox.example.com'),
    authToken: 'token',
    source: 'settings' as const,
  };

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('reports the readiness summary with discovered capabilities and version', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/readiness')) {
        return json({ summary: 'durable storage, inference ready' });
      }
      if (url.endsWith('/api/kernel/capabilities')) {
        return json({ capabilities: [{ name: 'browser' }], api_version: '1.4.0' });
      }
      return json({ status: 'ok' });
    }) as unknown as typeof fetch;

    const result = await verifyCyvoxEndpoint(target);

    expect(result).toMatchObject({
      success: true,
      summary: 'durable storage, inference ready',
      capabilities: ['browser'],
      apiVersion: '1.4.0',
    });
    expect(result.success && typeof result.latencyMs).toBe('number');
    expect(result.success && result.checkedAt).toBeTruthy();
  });

  it('passes when an older service has no discovery endpoints', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return url.endsWith('/api/readiness') ? json({ summary: 'ok' }) : json({ detail: 'x' }, 404);
    }) as unknown as typeof fetch;

    const result = await verifyCyvoxEndpoint(target);

    expect(result).toMatchObject({ success: true, summary: 'ok' });
    expect(result).not.toHaveProperty('capabilities');
  });

  it('maps a rejected credential without probing further', async () => {
    const fetchMock = jest.fn(async () => json({ detail: 'Authentication required' }, 401));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(verifyCyvoxEndpoint(target)).resolves.toMatchObject({
      success: false,
      errorCode: 'invalid_credentials',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('toProbeRecord', () => {
  it('keeps the outcome and capability summary but no credential', () => {
    const record = toProbeRecord({
      success: true,
      capabilities: ['browser'],
      apiVersion: '1.4.0',
      checkedAt: '2026-10-30T00:00:00.000Z',
    });

    expect(record).toEqual({
      checkedAt: '2026-10-30T00:00:00.000Z',
      success: true,
      capabilities: ['browser'],
      apiVersion: '1.4.0',
    });
    expect(JSON.stringify(record)).not.toContain('token');
  });

  it('records the failure code and nothing else', () => {
    expect(
      toProbeRecord({
        success: false,
        errorCode: 'timeout',
        checkedAt: '2026-10-30T00:00:00.000Z',
      }),
    ).toEqual({ checkedAt: '2026-10-30T00:00:00.000Z', success: false, errorCode: 'timeout' });
  });
});
