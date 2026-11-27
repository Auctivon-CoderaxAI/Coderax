import { MemoryRouter } from 'react-router-dom';
import { renderHook } from '@testing-library/react';
import { EModelEndpoint, Permissions, PermissionTypes, SystemRoles } from 'coderax-data-provider';
import type { ReactNode } from 'react';
import { SchedulePanel } from '~/components/SidePanel/Schedules';
import useUnifiedSidebarLinks from '../useUnifiedSidebarLinks';

let mockUser: { role: SystemRoles } = { role: SystemRoles.ADMIN };
let mockScheduleAccess = false;
let mockSchedulesConfig: boolean | { use?: boolean } | undefined = true;
let mockAgentAccess = { use: false, create: false };
let mockResearchAccess: { canAccess: boolean } | undefined;
let mockEndpointsConfig: Record<string, { disableBuilder?: boolean }> | undefined;

const mockHasAccess = jest.fn((request: { permissionType: unknown; permission: unknown }) => {
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
});

jest.mock('~/hooks', () => ({
  useAuthContext: () => ({ user: mockUser }),
  useHasAccess: () => false,
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: undefined }),
  useHasAccess: (request: { permissionType: unknown; permission: unknown }) =>
    mockHasAccess(request),
}));

jest.mock('~/data-provider', () => ({
  useGetEndpointsQuery: () => ({ data: mockEndpointsConfig }),
  useGetStartupConfig: () => ({ data: { interface: { schedules: mockSchedulesConfig } } }),
  useResearchCapabilitiesQuery: () => ({ data: mockResearchAccess }),
}));

jest.mock('~/components/UnifiedSidebar/ConversationsSection', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('~/components/SidePanel/Schedules', () => ({ SchedulePanel: () => null }));
jest.mock('~/components/Taskbar/PluginsPanel', () => ({ __esModule: true, default: () => null }));
jest.mock('~/components/SidePanel/Agents/AgentPanelSwitch', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('~/components/SidePanel/Schedules', () => ({
  SchedulePanel: () => null,
}));

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe('Coderax sidebar links', () => {
  beforeEach(() => {
    mockUser = { role: SystemRoles.ADMIN };
    mockScheduleAccess = false;
    mockSchedulesConfig = true;
    mockAgentAccess = { use: false, create: false };
    mockResearchAccess = undefined;
    mockEndpointsConfig = undefined;
  });

  it('restores the owner Agent Builder in the unified sidebar when configured and authorized', () => {
    mockAgentAccess = { use: true, create: true };
    mockEndpointsConfig = { [EModelEndpoint.agents]: {} };
    const { result } = renderHook(() => useUnifiedSidebarLinks(), { wrapper });
    expect(result.current.map((link) => link.id)).toEqual([
      'conversations',
      'plugins',
      'games',
      'research',
    ]);
    expect(result.current[0].Component).toBeDefined();
    const builder = result.current.find((link) => link.id === EModelEndpoint.agents);

    expect(result.current.map((link) => link.id)).toEqual([
      'conversations',
      EModelEndpoint.agents,
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
      'games',
      'research',
    ]);
    expect(result.current.find((link) => link.id === 'schedules')?.Component).toBe(SchedulePanel);
    expect(result.current.find((link) => link.id === 'games')?.onClick).toBeDefined();
  });

  it('omits owner-only Game Studio and inaccessible Agent Builder for a non-owner', () => {
    mockUser = { role: SystemRoles.USER };
    const { result } = renderHook(() => useUnifiedSidebarLinks(), { wrapper });
    expect(result.current.map((link) => link.id)).toEqual(['conversations']);
  });

  it('follows the advertised research policy without exposing Game Studio', () => {
    mockUser = { role: SystemRoles.USER };
    mockResearchAccess = { canAccess: true };
    const { result } = renderHook(() => useUnifiedSidebarLinks(), { wrapper });
    expect(result.current.map((link) => link.id)).toEqual(['conversations', 'research']);
  });

  it('omits the Agent Builder when the endpoint is not configured', () => {
    mockAgentAccess = { use: true, create: true };
    mockEndpointsConfig = {};
    const { result } = renderHook(() => useUnifiedSidebarLinks(), { wrapper });
    expect(result.current.map((link) => link.id)).not.toContain('agents');
  });

  it('does not offer Agent Builder when the endpoint disables it', () => {
    mockAgentAccess = { use: true, create: true };
    mockEndpointsConfig = { [EModelEndpoint.agents]: { disableBuilder: true } };
    const { result } = renderHook(() => useUnifiedSidebarLinks(), { wrapper });
    expect(result.current.some((link) => link.id === EModelEndpoint.agents)).toBe(false);
  });

  it('requires both Agent Builder permissions', () => {
    mockEndpointsConfig = { [EModelEndpoint.agents]: {} };
    mockAgentAccess = { use: false, create: true };
    const withoutUsePermission = renderHook(() => useUnifiedSidebarLinks(), { wrapper });
    expect(
      withoutUsePermission.result.current.some((link) => link.id === EModelEndpoint.agents),
    ).toBe(false);
    withoutUsePermission.unmount();

    mockAgentAccess = { use: true, create: false };
    const withoutCreatePermission = renderHook(() => useUnifiedSidebarLinks(), { wrapper });
    expect(
      withoutCreatePermission.result.current.some((link) => link.id === EModelEndpoint.agents),
    ).toBe(false);
  });

  it('does not offer Agent Builder before the endpoint config is available', () => {
    mockAgentAccess = { use: true, create: true };
    const { result } = renderHook(() => useUnifiedSidebarLinks(), { wrapper });
    expect(result.current.some((link) => link.id === EModelEndpoint.agents)).toBe(false);
  });

  it.each([true, {}, { use: true }])('opens schedule management when opted in (%j)', (config) => {
    mockUser = { role: SystemRoles.USER };
    mockScheduleAccess = true;
    mockSchedulesConfig = config;
    const { result } = renderHook(() => useUnifiedSidebarLinks(), { wrapper });

    expect(mockHasAccess).toHaveBeenCalledWith({
      permissionType: PermissionTypes.SCHEDULES,
      permission: Permissions.USE,
    });
    expect(result.current.find((link) => link.id === 'schedules')?.Component).toBe(SchedulePanel);
  });

  it.each([undefined, false, { use: false }])(
    'hides schedule management when the deployment has it disabled (%j)',
    (config) => {
      mockScheduleAccess = true;
      mockSchedulesConfig = config;
      const { result } = renderHook(() => useUnifiedSidebarLinks(), { wrapper });
      expect(result.current.some((link) => link.id === 'schedules')).toBe(false);
    },
  );

  it('hides schedule management without schedule permission', () => {
    mockScheduleAccess = false;
    mockSchedulesConfig = true;
    const { result } = renderHook(() => useUnifiedSidebarLinks(), { wrapper });
    expect(result.current.some((link) => link.id === 'schedules')).toBe(false);
  });
});
