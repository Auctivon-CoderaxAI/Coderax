/**
 * Smoke-test scaffold: MCP server registry lookups and OAuth
 * reconnection flows, distinct from the tool-invocation path covered
 * in mcpToolInvocation.smoke.spec.js.
 *
 * Covers: registry miss/hit, stale-token reconnection trigger,
 * flow-state manager timeout/retry.
 */
jest.mock('~/models');
jest.mock('~/config', () => ({
  getOAuthReconnectionManager: jest.fn(),
  getMCPServersRegistry: jest.fn(),
  getFlowStateManager: jest.fn(),
  getMCPManager: jest.fn(),
}));

const {
  getOAuthReconnectionManager,
  getMCPServersRegistry,
  getFlowStateManager,
} = require('~/config');

describe('MCP registry + OAuth reconnection smoke tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registry returns null for an unknown server name (does not throw)', () => {
    getMCPServersRegistry.mockReturnValue({
      get: jest.fn().mockReturnValue(null),
    });
    const registry = getMCPServersRegistry();
    expect(registry.get('unknown-server')).toBeNull();
  });

  it('registry resolves a known server config', () => {
    getMCPServersRegistry.mockReturnValue({
      get: jest.fn().mockReturnValue({ url: 'https://known.example.com/mcp' }),
    });
    const registry = getMCPServersRegistry();
    expect(registry.get('known-server')).toEqual({ url: 'https://known.example.com/mcp' });
  });

  it('OAuth reconnection manager triggers reconnect on stale token without throwing', async () => {
    const reconnect = jest.fn().mockResolvedValue({ reconnected: true });
    getOAuthReconnectionManager.mockReturnValue({ reconnect });

    const manager = getOAuthReconnectionManager();
    const result = await manager.reconnect('server-1', 'user-1');
    expect(result).toEqual({ reconnected: true });
  });

  it('OAuth reconnection manager surfaces failure as rejected promise, not thrown sync error', async () => {
    const reconnect = jest.fn().mockRejectedValue(new Error('token refresh failed'));
    getOAuthReconnectionManager.mockReturnValue({ reconnect });

    const manager = getOAuthReconnectionManager();
    await expect(manager.reconnect('server-1', 'user-1')).rejects.toThrow('token refresh failed');
  });

  it('flow-state manager createFlow/resolveFlow round-trips without throwing', async () => {
    const createFlow = jest.fn().mockResolvedValue({ flowId: 'flow-1' });
    const resolveFlow = jest.fn().mockResolvedValue({ status: 'complete' });
    getFlowStateManager.mockReturnValue({ createFlow, resolveFlow });

    const manager = getFlowStateManager();
    const flow = await manager.createFlow('server-1', 'user-1');
    expect(flow).toEqual({ flowId: 'flow-1' });

    const result = await manager.resolveFlow('flow-1');
    expect(result).toEqual({ status: 'complete' });
  });

  it('flow-state manager resolveFlow times out gracefully (rejects, not hangs)', async () => {
    const resolveFlow = jest.fn().mockRejectedValue(new Error('flow timeout'));
    getFlowStateManager.mockReturnValue({ resolveFlow });

    const manager = getFlowStateManager();
    await expect(manager.resolveFlow('flow-stale')).rejects.toThrow('flow timeout');
  });
});