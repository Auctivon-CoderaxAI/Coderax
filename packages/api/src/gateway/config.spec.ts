import {
  DEFAULT_MAX_EVENT_RESYNCS,
  DEFAULT_MAX_FRAME_BYTES,
  DEFAULT_MAX_RESPONSE_BYTES,
  resolveGatewayConfig,
  resolveGatewayOptions,
} from './config';

const env = { CODERAX_ENGINE_TOKEN: 'server-token' } as NodeJS.ProcessEnv;

describe('WorkflowEngine gateway configuration', () => {
  it('keeps the YAML value unchanged when no root override exists', () => {
    const yaml = { enabled: true, baseURL: 'https://yaml.example', requestTimeoutMs: 5_000 };
    expect(resolveGatewayOptions({ config: { workflowEngine: yaml } })).toEqual(yaml);
  });

  it('merges a partial root override over the YAML value', () => {
    expect(
      resolveGatewayOptions({
        config: {
          workflowEngine: {
            enabled: true,
            baseURL: 'https://yaml.example',
            tokenEnv: 'YAML_TOKEN',
          },
        },
        workflowEngine: { enabled: false, maxFrameBytes: 32_768 },
      }),
    ).toEqual({
      enabled: false,
      baseURL: 'https://yaml.example',
      tokenEnv: 'YAML_TOKEN',
      maxFrameBytes: 32_768,
    });
  });

  it('lets a root override replace scalar fields', () => {
    expect(
      resolveGatewayOptions({
        config: { workflowEngine: { enabled: true, baseURL: 'https://yaml.example' } },
        workflowEngine: { baseURL: 'https://override.example' },
      }),
    ).toEqual({ enabled: true, baseURL: 'https://override.example' });
  });

  it('returns no options when neither layer configures the gateway', () => {
    expect(resolveGatewayOptions(undefined)).toBeUndefined();
    expect(resolveGatewayOptions({})).toBeUndefined();
    expect(resolveGatewayOptions({ config: { workflowEngine: null } })).toBeUndefined();
  });

  it('defaults every transport limit to the previous behavior', () => {
    const result = resolveGatewayConfig({ enabled: true, baseURL: 'https://engine.example' }, env);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.value.enabled) {
      return;
    }
    expect(result.value.maxResponseBytes).toBe(DEFAULT_MAX_RESPONSE_BYTES);
    expect(result.value.maxFrameBytes).toBe(DEFAULT_MAX_FRAME_BYTES);
    expect(result.value.maxEventResyncs).toBe(DEFAULT_MAX_EVENT_RESYNCS);
  });

  it.each([
    { maxResponseBytes: 0 },
    { maxFrameBytes: -1 },
    { maxEventResyncs: -1 },
    { maxEventResyncs: 1.5 },
  ])('rejects an invalid limit (%j)', (limits) => {
    const result = resolveGatewayConfig(
      { enabled: true, baseURL: 'https://engine.example', ...limits },
      env,
    );
    expect(result).toMatchObject({
      ok: false,
      code: 'WORKFLOW_ENGINE_INVALID_CONFIG',
    });
  });

  it('accepts a zero resync budget', () => {
    const result = resolveGatewayConfig(
      { enabled: true, baseURL: 'https://engine.example', maxEventResyncs: 0 },
      env,
    );
    expect(result.ok).toBe(true);
    if (result.ok && result.value.enabled) {
      expect(result.value.maxEventResyncs).toBe(0);
    }
  });

  it('fingerprints the limits without the credential', () => {
    const first = resolveGatewayConfig({ enabled: true, baseURL: 'https://engine.example' }, env);
    const second = resolveGatewayConfig(
      {
        enabled: true,
        baseURL: 'https://engine.example',
        maxFrameBytes: 32_768,
      },
      env,
    );
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok || !first.value.enabled || !second.value.enabled) {
      return;
    }
    expect(first.value.fingerprint).not.toBe(second.value.fingerprint);
    expect(first.value.fingerprint).not.toContain('server-token');
  });

  it('refuses a contract version this build does not implement', () => {
    const result = resolveGatewayConfig(
      { enabled: true, baseURL: 'https://engine.example', contractVersion: '1.1.0' },
      env,
    );
    expect(result).toMatchObject({
      ok: false,
      code: 'WORKFLOW_ENGINE_INVALID_CONFIG',
    });
  });
});
