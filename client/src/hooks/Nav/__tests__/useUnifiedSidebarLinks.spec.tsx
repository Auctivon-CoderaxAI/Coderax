import { MemoryRouter } from 'react-router-dom';
import { renderHook } from '@testing-library/react';
import {
  EModelEndpoint,
  Permissions,
  PermissionTypes,
  SystemRoles,
} from 'coderax-data-provider';
import type { ReactNode } from 'react';
import useUnifiedSidebarLinks from '../useUnifiedSidebarLinks';

let mockUser: { role: SystemRoles } = { role: SystemRoles.ADMIN };
let mockScheduleAccess = false;
let mockAgentAccess = { use: false, create: false };
let mockResearchAccess: { canAccess: boolean } | undefined;
let mockEndpointsConfig: Record<string, { disableBuilder?: boolean }> | undefined;

const mockHasAccess = jest.fn(
  (request: { permissionType: unknown; permission: unknown }) => {
    if (request.permissionType === PermissionTypes.SCHEDULES) {
      return mockScheduleAccess;
    }
    if (request.permissionType === PermissionTypes.AGENTS) {
      if (request.permission === Permissions.USE) {
        return mockAgentAccess.use;
      }
      if (request.permission === Permissions.CREATE) {
        return mockAgentAccess.create;
      }
    }
    return false;
  },
);

jest.mock('~/hooks', () => ({
  useAuthContext: () => ({ user: mockUser }),
  useHasAccess: (request: { permissionType: unknown; permission: unknown }) =>
    mockHasAccess(request),
}));

jest.mock('~/data-provider', () => ({
  useGetEndpointsQuery: () => ({ data: mockEndpointsConfig }),
  useGetStartupConfig: () => ({ data: { interface: { schedules: true } } }),
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

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe('Coderax sidebar links', () => {
  beforeEach(() => {
    mockUser = { role: SystemRoles.ADMIN };
    mockScheduleAccess = false;
    mockAgentAccess = { use: false, create: false };
    mockResearchAccess = undefined;
    mockEndpointsConfig = undefined;
  });

  it('restores the owner Agent Builder in the unified sidebar when configured and authorized', () => {
    mockAgentAccess = { use: true, create: true };
    mockEndpointsConfig = { [EModelEndpoint.agents]: {} };
    const { result } = renderHook(() => useUnifiedSidebarLinks(), { wrapper });
    const builder = result.current.find((link) => link.id === EModelEndpoint.agents);

    expect(result.current.map((link) => link.id)).toEqual([
      'conversations',
      EModelEndpoint.agents,
      'plugins',
      'games',
      'research',
    ]);
    expect(builder).toEqual(
      expect.objectContaining({
        title: 'com_sidepanel_agent_builder',
        Component: expect.any(Function),
      }),
    );
  });

  it('keeps schedule and owner destinations in the current sidebar architecture', () => {
    mockScheduleAccess = true;
    const { result } = renderHook(() => useUnifiedSidebarLinks(), { wrapper });
    expect(result.current.map((link) => link.id)).toEqual([
      'conversations',
      'schedules',
      'plugins',
      'games',
      'research',
    ]);
    expect(result.current.find((link) => link.id === 'schedules')?.Component).toBeDefined();
    expect(result.current.find((link) => link.id === 'games')?.onClick).toBeDefined();
  });

  it('omits Game Studio and gated Agent Builder access for a non-owner', () => {
    mockUser = { role: SystemRoles.USER };
    mockAgentAccess = { use: true, create: true };
    mockEndpointsConfig = { [EModelEndpoint.agents]: {} };
    const { result } = renderHook(() => useUnifiedSidebarLinks(), { wrapper });
    expect(result.current.map((link) => link.id)).toEqual(['conversations', 'plugins']);
  });

  it('follows the advertised research policy without exposing Game Studio', () => {
    mockUser = { role: SystemRoles.USER };
    mockResearchAccess = { canAccess: true };
    const { result } = renderHook(() => useUnifiedSidebarLinks(), { wrapper });
    expect(result.current.map((link) => link.id)).toEqual(['conversations', 'plugins', 'research']);
  });

  it('does not offer Agent Builder when the endpoint disables it', () => {
    mockAgentAccess = { use: true, create: true };
    mockEndpointsConfig = { [EModelEndpoint.agents]: { disableBuilder: true } };
    const { result } = renderHook(() => useUnifiedSidebarLinks(), { wrapper });
    expect(result.current.some((link) => link.id === EModelEndpoint.agents)).toBe(false);
  });

  it.each([
    ['use', false, true],
    ['create', true, false],
  ])('requires the %s permission to offer Agent Builder', (_permission, use, create) => {
    mockAgentAccess = { use, create };
    mockEndpointsConfig = { [EModelEndpoint.agents]: {} };
    const { result } = renderHook(() => useUnifiedSidebarLinks(), { wrapper });
    expect(result.current.some((link) => link.id === EModelEndpoint.agents)).toBe(false);
  });
});
