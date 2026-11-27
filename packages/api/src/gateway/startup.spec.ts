import { runWorkflowEngineStartup, startWorkflowEngineGateway } from './startup';

const options = { enabled: true, baseURL: 'https://engine.example' };

describe('WorkflowEngine startup', () => {
  it('runs the gateway prewarm once with the resolved options', async () => {
    const prewarm = jest.fn().mockResolvedValue({ compatible: true });
    const report = await runWorkflowEngineStartup({
      gateway: { prewarm },
      resolveConfig: async () => options,
    });
    expect(prewarm).toHaveBeenCalledWith(options);
    expect(report).toEqual({ compatible: true });
  });

  it('records only a stable failure code when configuration cannot load', async () => {
    const warn = jest.fn();
    const report = await runWorkflowEngineStartup({
      gateway: { prewarm: jest.fn() },
      resolveConfig: async () => {
        throw Object.assign(new Error('https://secret.example/token?value=1'), {
          code: 'config_unavailable',
        });
      },
      logger: { warn },
    });
    expect(report).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      '[workflow-engine] startup check skipped: config_unavailable',
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret.example');
  });

  it('does not start under Jest', () => {
    const prewarm = jest.fn();
    startWorkflowEngineGateway({
      gateway: { prewarm },
      resolveConfig: async () => options,
      env: { NODE_ENV: 'test' } as NodeJS.ProcessEnv,
    });
    expect(prewarm).not.toHaveBeenCalled();
  });
});
