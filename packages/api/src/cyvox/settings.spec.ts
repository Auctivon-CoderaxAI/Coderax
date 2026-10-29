import { buildCyvoxConnectionStatus, normalizeCyvoxBaseUrl, resolveCyvoxTarget } from './settings';

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
