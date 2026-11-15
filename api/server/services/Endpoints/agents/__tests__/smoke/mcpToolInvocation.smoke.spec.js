jest.mock('@librechat/agents/langchain/tools', () => ({ tool: jest.fn() }), { virtual: true });
jest.mock('@librechat/agents', () => ({ Providers: {}, Constants: {} }), { virtual: true });
jest.mock(
  '@coderax/data-schemas',
  () => ({
    logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
    getTenantId: jest.fn(),
  }),
  { virtual: true },
);
jest.mock(
  'coderax-data-provider',
  () => ({
    Constants: { mcp_delimiter: '_mcp_' },
    Permissions: { USE: 'USE' },
    PermissionTypes: { MCP_SERVERS: 'MCP_SERVERS' },
    Time: {},
    CacheKeys: {},
    resolveMCPAppsPolicy: jest.fn(),
  }),
  { virtual: true },
);
jest.mock(
  '@coderax/api',
  () => ({
    checkAccessWithRequestCache: jest.fn(),
    resolveMCPClientCapabilityProfile: jest.fn(() => 'default-profile'),
    splitMCPToolKey: jest.fn((key) => key.split('_mcp_')),
    normalizeServerName: jest.fn((name) => name),
    stripServerNamePrefix: jest.fn((name) => name),
    buildServerNameAliases: jest.fn(() => new Map()),
    requiresEphemeralUserConnection: jest.fn(() => false),
    getMCPConnectionPoolKey: jest.fn((key) => key),
    processMCPEnv: jest.fn(({ options }) => options),
    isUserSourced: jest.fn(() => false),
    buildMCPDomainValidationConfig: jest.fn((config) => ({ url: config.url })),
    getServerCustomUserVars: jest.fn(() => ({})),
    containsGraphTokenPlaceholder: jest.fn(() => false),
    isMCPDomainAllowed: jest.fn(),
  }),
  { virtual: true },
);
jest.mock('~/config', () => ({
  getOAuthReconnectionManager: jest.fn(),
  getMCPServersRegistry: jest.fn(),
  getFlowStateManager: jest.fn(),
  getMCPManager: jest.fn(),
}));
jest.mock('~/models', () => ({ getRoleByName: jest.fn() }));
jest.mock('~/cache', () => ({ getLogStores: jest.fn() }));
jest.mock('~/server/services/GraphTokenService', () => ({ getGraphApiToken: jest.fn() }));
jest.mock('~/server/services/OboTokenService', () => ({ exchangeOboToken: jest.fn() }));
jest.mock('~/server/services/OboPolicyService', () => ({ createOboTrustChecker: jest.fn() }));
jest.mock('~/server/services/OpenIDSessionRefresh', () => ({ createOpenIDSessionTokenProvider: jest.fn() }));
jest.mock('~/server/services/Tools/mcp', () => ({ reinitMCPServer: jest.fn() }));
jest.mock('~/server/services/MCPAuthorizationFenceRetry', () => ({
  clearMCPAuthorizationFenceRetry: jest.fn(),
  persistMCPAuthorizationFenceRetry: jest.fn(),
}));
jest.mock('~/server/services/Config', () => ({
  getAppConfig: jest.fn(),
  getCachedTools: jest.fn(),
  getMCPServerTools: jest.fn(),
  cacheMCPServerTools: jest.fn(),
  invalidateCachedTools: jest.fn(),
}));

const { logger } = require('@coderax/data-schemas');
const { checkAccessWithRequestCache, isMCPDomainAllowed } = require('@coderax/api');
const { getMCPManager, getMCPServersRegistry } = require('~/config');
const { getAppConfig } = require('~/server/services/Config');
const db = require('~/models');
const { userCanUseMCPServers, createMCPTool } = require('~/server/services/MCP');

describe('MCP tool-invocation (MCP.js)', () => {
  const user = { id: 'user-1', role: 'USER', tenantId: 'tenant-1' };
  const req = { user };

  it('denies MCP use for a user without an id or role without checking permissions', async () => {
    await expect(userCanUseMCPServers({ id: 'user-1' }, req)).resolves.toBe(false);
    await expect(userCanUseMCPServers(undefined, req)).resolves.toBe(false);
    expect(checkAccessWithRequestCache).not.toHaveBeenCalled();
  });

  it('checks the MCP_SERVERS USE permission through the request cache', async () => {
    checkAccessWithRequestCache.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await expect(userCanUseMCPServers(user, req)).resolves.toBe(true);
    await expect(userCanUseMCPServers(user, req)).resolves.toBe(false);
    expect(checkAccessWithRequestCache).toHaveBeenCalledWith({
      req,
      user,
      permissionType: 'MCP_SERVERS',
      permissions: ['USE'],
      getRoleByName: db.getRoleByName,
    });
  });

  it('fails closed and logs when the permission check throws', async () => {
    checkAccessWithRequestCache.mockRejectedValueOnce(new Error('role store unavailable'));

    await expect(userCanUseMCPServers(user, req)).resolves.toBe(false);
    expect(logger.error).toHaveBeenCalledWith('[MCP][User: user-1] Failed MCP permission check');
  });

  it('skips tool creation when the server URL domain is no longer allowed', async () => {
    getAppConfig.mockResolvedValueOnce({
      mcpSettings: { allowedDomains: ['allowed.example'], allowedAddresses: ['127.0.0.1:3000'] },
    });
    isMCPDomainAllowed.mockResolvedValueOnce(false);

    const result = await createMCPTool({
      res: {},
      user,
      config: { url: 'https://blocked.example/mcp' },
      toolKey: 'search_mcp_docs',
      provider: 'openai',
      userMCPAuthMap: {},
      availableTools: {},
    });

    expect(result).toBeUndefined();
    expect(isMCPDomainAllowed).toHaveBeenCalledWith(
      { url: 'https://blocked.example/mcp' },
      ['allowed.example'],
      ['127.0.0.1:3000'],
    );
    expect(logger.warn).toHaveBeenCalledWith('[MCP] Domain no longer allowed; skipping tool creation');
    expect(getMCPServersRegistry).not.toHaveBeenCalled();
    expect(getMCPManager).not.toHaveBeenCalled();
  });
});