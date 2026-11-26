import type { WorkflowEngineGatewayOptions } from './config';
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

  it('lets an owner disable an enabled deployment and tune request limits', () => {
    const yaml = { enabled: true, baseURL: 'https://yaml.example', tokenEnv: 'YAML_TOKEN' };
    expect(
      resolveGatewayOptions(
        { config: { workflowEngine: yaml } },
        {
          enabled: false,
          maxFrameBytes: 32_768,
        },
      ),
    ).toEqual({ ...yaml, enabled: false, maxFrameBytes: 32_768 });
  });

  it.each<WorkflowEngineGatewayOptions | undefined>([undefined, {}, { enabled: false }])(
    'cannot enable the gateway through a stored preference when deployment is off (%j)',
    (yaml) => {
      const options = resolveGatewayOptions(
        { config: { workflowEngine: yaml } },
        { enabled: true, baseURL: 'https://override.example' },
      );
      expect(resolveGatewayConfig(options, env)).toEqual({ ok: true, value: { enabled: false } });
    },
  );

  it('uses only the deployment destination, token source, version and startup policy', () => {
    const yaml = { enabled: true, baseURL: 'https://yaml.example', startupCheck: true };
    expect(
      resolveGatewayOptions(
        { config: { workflowEngine: yaml } },
        {
          baseURL: 'https://override.example',
          tokenEnv: 'OTHER_SECRET',
          contractVersion: '2.0.0',
          startupCheck: false,
          maxEventResyncs: 0,
        },
      ),
    ).toEqual({ ...yaml, maxEventResyncs: 0 });
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
