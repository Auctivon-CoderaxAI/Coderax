import type { CompatibilityReport } from './compat';
import { prewarmWorkflowEngine, startWorkflowEnginePrewarm } from './startup';

const at = '2026-11-26T00:00:00.000Z';

function report(): CompatibilityReport {
  return {
    compatible: true,
    contractVersion: '1.0.0',
    engineStatus: 'ok',
    capabilities: { streaming: true, cancellation: true, resume: true, durable: true },
    workCapable: true,
    checkedAt: at,
  };
}

describe('workflow engine startup check', () => {
  it('runs the handshake with the resolved deployment config', async () => {
    const config = { enabled: true, baseURL: 'https://engine.example', ownerUserId: 'owner_1' };
    const prewarm = jest.fn(async () => report());

    const result = await prewarmWorkflowEngine({
      resolveConfig: () => config,
      gateway: { prewarm },
    });

    expect(result).toEqual(report());
    expect(prewarm).toHaveBeenCalledWith(config);
  });

  it('skips the handshake when startupCheck is false', async () => {
    const prewarm = jest.fn(async () => report());

    const result = await prewarmWorkflowEngine({
      resolveConfig: () => ({
        enabled: true,
        baseURL: 'https://engine.example',
        ownerUserId: 'owner_1',
        startupCheck: false,
      }),
      gateway: { prewarm },
    });

    expect(result).toBeNull();
    expect(prewarm).not.toHaveBeenCalled();
  });

  it('stays fail-closed when the deployment config cannot be read', async () => {
    const warn = jest.fn();

    const result = await prewarmWorkflowEngine({
      resolveConfig: async () => {
        throw new Error('config store unavailable');
      },
      gateway: { prewarm: async () => report() },
      logger: { warn },
    });

    expect(result).toBeNull();
    expect(warn).toHaveBeenCalledWith('[workflow-engine] startup check skipped', {
      error: 'config store unavailable',
    });
  });

  it('does not reach an engine in a test process', () => {
    const prewarm = jest.fn();

    startWorkflowEnginePrewarm({
      resolveConfig: () => null,
      gateway: { prewarm },
      env: { NODE_ENV: 'test' } as NodeJS.ProcessEnv,
    });

    expect(prewarm).not.toHaveBeenCalled();
  });

  it('runs the check once outside a test process', async () => {
    const prewarm = jest.fn(async () => report());

    startWorkflowEnginePrewarm({
      resolveConfig: () => null,
      gateway: { prewarm },
      env: {} as NodeJS.ProcessEnv,
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(prewarm).toHaveBeenCalledTimes(1);
  });
});
