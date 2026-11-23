jest.mock('@librechat/agents/langchain/tools', () => ({ tool: jest.fn() }));
jest.mock('@librechat/agents', () => ({ Providers: {}, Constants: {} }));
jest.mock('@coderax/data-schemas', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
  getTenantId: jest.fn(),
}));
jest.mock('coderax-data-provider', () => ({
  Constants: { mcp_delimiter: '_mcp_' },
  Permissions: { USE: 'USE' },
  PermissionTypes: { MCP_SERVERS: 'MCP_SERVERS' },
  Time: {},
  CacheKeys: {},
  resolveMCPAppsPolicy: jest.fn(),
}));
jest.mock('@coderax/api', () => ({
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
  isMCPDomainAllowed: jest.fn(async () => false),
}));
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
jest.mock('~/server/services/OpenIDSessionRefresh', () => ({
  createOpenIDSessionTokenProvider: jest.fn(),
}));
jest.mock('~/server/services/Tools/mcp', () => ({ reinitMCPServer: jest.fn() }));
jest.mock('~/server/services/MCPAuthorizationFenceRetry', () => ({
  clearMCPAuthorizationFenceRetry: jest.fn(),
  persistMCPAuthorizationFenceRetry: jest.fn(),
}));
jest.mock('~/server/services/Config', () => ({
  getAppConfig: jest.fn(async () => ({ mcpSettings: {} })),
  getCachedTools: jest.fn(),
  getMCPServerTools: jest.fn(),
  cacheMCPServerTools: jest.fn(),
  invalidateCachedTools: jest.fn(),
}));

const {
  isUserSourced,
  processMCPEnv,
  getServerCustomUserVars,
  isMCPDomainAllowed,
} = require('@coderax/api');
const { getAppConfig } = require('~/server/services/Config');
const { createMCPTool } = require('~/server/services/MCP');

describe('MCP tool-invocation domain gate inputs (MCP.js)', () => {
  const user = { id: 'user-1', role: 'USER', tenantId: 'tenant-1' };
  const baseParams = {
    res: {},
    user,
    config: { url: 'https://docs.example/mcp' },
    toolKey: 'search_mcp_docs',
    provider: 'openai',
    availableTools: {},
  };

  it('loads app config for the requesting user before checking the domain', async () => {
    await createMCPTool({ ...baseParams, userMCPAuthMap: {} });

    expect(getAppConfig).toHaveBeenCalledWith({
      role: 'USER',
      tenantId: 'tenant-1',
      userId: 'user-1',
    });
    expect(isMCPDomainAllowed).toHaveBeenCalledWith(
      { url: 'https://docs.example/mcp' },
      undefined,
      undefined,
    );
  });

  it('validates a user-sourced server with its own custom user variables', async () => {
    const userMCPAuthMap = { docs: { API_HOST: 'docs.example' } };
    const requestBody = { conversationId: 'convo-1' };
    isUserSourced.mockReturnValueOnce(true);
    getServerCustomUserVars.mockReturnValueOnce({ API_HOST: 'docs.example' });

    await createMCPTool({ ...baseParams, userMCPAuthMap, requestBody });

    expect(getServerCustomUserVars).toHaveBeenCalledWith(userMCPAuthMap, 'docs');
    expect(processMCPEnv).toHaveBeenCalledWith({
      user,
      body: requestBody,
      dbSourced: true,
      options: { url: 'https://docs.example/mcp' },
      customUserVars: { API_HOST: 'docs.example' },
    });
  });

  it('prefers the loader-resolved raw server name over the parsed tool key suffix', async () => {
    const userMCPAuthMap = {};

    await createMCPTool({ ...baseParams, userMCPAuthMap, serverName: 'Docs Server' });

    expect(getServerCustomUserVars).toHaveBeenCalledWith(userMCPAuthMap, 'Docs Server');
  });
});
