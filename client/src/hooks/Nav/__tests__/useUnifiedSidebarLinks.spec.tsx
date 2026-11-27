import { MemoryRouter } from 'react-router-dom';
import { renderHook } from '@testing-library/react';
import { Permissions, PermissionTypes, SystemRoles } from 'coderax-data-provider';
import type { ReactNode } from 'react';
import useUnifiedSidebarLinks from '../useUnifiedSidebarLinks';

let mockUser: { role: SystemRoles } = { role: SystemRoles.ADMIN };
let mockResearchAccess: { canAccess: boolean } | undefined;
let mockGranted = new Set<string>();
let mockEndpointsConfig: Record<string, { disableBuilder?: boolean }> = {
  agents: {},
};

jest.mock('~/hooks', () => ({
  useAuthContext: () => ({ user: mockUser }),
  useHasAccess: ({ permissionType, permission }: { permissionType: string; permission: string }) =>
    mockGranted.has(`${permissionType}:${permission}`),
}));

jest.mock('~/data-provider', () => ({
  useGetEndpointsQuery: () => ({ data: mockEndpointsConfig }),
  useGetStartupConfig: () => ({ data: undefined }),
  useResearchCapabilitiesQuery: () => ({ data: mockResearchAccess }),
}));

jest.mock('~/components/UnifiedSidebar/ConversationsSection', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('~/components/SidePanel/Agents/AgentPanelSwitch', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('~/components/SidePanel/Schedules', () => ({
  SchedulePanel: () => null,
}));

jest.mock('~/components/Taskbar/PluginsPanel', () => ({
  __esModule: true,
  default: () => null,
}));

const key = (type: PermissionTypes, permission: Permissions) => `${type}:${permission}`;

function grantAgentAccess() {
  mockGranted.add(key(PermissionTypes.AGENTS, Permissions.USE));
  mockGranted.add(key(PermissionTypes.AGENTS, Permissions.CREATE));
}

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe('Coderax sidebar links', () => {
  beforeEach(() => {
    mockUser = { role: SystemRoles.ADMIN };
    mockResearchAccess = undefined;
    mockGranted = new Set();
    mockEndpointsConfig = { agents: {} };
    grantAgentAccess();
  });

  it('keeps chat history, the Agent Builder, and the owner destinations', () => {
    const { result } = renderHook(() => useUnifiedSidebarLinks(), { wrapper });
    expect(result.current.map((link) => link.id)).toEqual([
      'conversations',
      'agents',
      'plugins',
      'games',
      'research',
    ]);
    expect(result.current[0].Component).toBeDefined();
    expect(result.current[1].Component).toBeDefined();
    expect(result.current.find((link) => link.id === 'games')?.onClick).toBeDefined();
  });

  it('omits Game Studio for a non-owner, whose routes reject them', () => {
    mockUser = { role: SystemRoles.USER };
    const { result } = renderHook(() => useUnifiedSidebarLinks(), { wrapper });
    expect(result.current.map((link) => link.id)).toEqual(['conversations', 'agents', 'plugins']);
  });

  it('follows the advertised research policy without exposing Game Studio', () => {
    mockUser = { role: SystemRoles.USER };
    mockResearchAccess = { canAccess: true };
    const { result } = renderHook(() => useUnifiedSidebarLinks(), { wrapper });
    expect(result.current.map((link) => link.id)).toEqual([
      'conversations',
      'agents',
      'plugins',
      'research',
    ]);
  });

  it('omits the Agent Builder when the endpoint is not configured', () => {
    mockEndpointsConfig = {};
    const { result } = renderHook(() => useUnifiedSidebarLinks(), { wrapper });
    expect(result.current.map((link) => link.id)).not.toContain('agents');
  });

  it('omits the Agent Builder when the builder is disabled', () => {
    mockEndpointsConfig = { agents: { disableBuilder: true } };
    const { result } = renderHook(() => useUnifiedSidebarLinks(), { wrapper });
    expect(result.current.map((link) => link.id)).not.toContain('agents');
  });

  it('requires both agent permissions', () => {
    mockGranted.delete(key(PermissionTypes.AGENTS, Permissions.CREATE));
    const { result } = renderHook(() => useUnifiedSidebarLinks(), { wrapper });
    expect(result.current.map((link) => link.id)).not.toContain('agents');

    mockGranted.add(key(PermissionTypes.AGENTS, Permissions.CREATE));
    mockGranted.delete(key(PermissionTypes.AGENTS, Permissions.USE));
    const withoutUse = renderHook(() => useUnifiedSidebarLinks(), { wrapper });
    expect(withoutUse.result.current.map((link) => link.id)).not.toContain('agents');
  });
});
