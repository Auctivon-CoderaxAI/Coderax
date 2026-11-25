import { MemoryRouter } from 'react-router-dom';
import { renderHook } from '@testing-library/react';
import { Permissions, PermissionTypes, SystemRoles } from 'coderax-data-provider';
import type { ReactNode } from 'react';
import { SchedulePanel } from '~/components/SidePanel/Schedules';
import useUnifiedSidebarLinks from '../useUnifiedSidebarLinks';

let mockUser: { role: SystemRoles } = { role: SystemRoles.ADMIN };
let mockResearchAccess: { canAccess: boolean } | undefined;
let mockSchedulesConfig: boolean | { use?: boolean } | undefined;
const mockHasAccess = jest.fn();

jest.mock('~/hooks', () => ({
  useAuthContext: () => ({ user: mockUser }),
  useHasAccess: (...args: unknown[]) => mockHasAccess(...args),
}));

jest.mock('~/data-provider', () => ({
  useResearchCapabilitiesQuery: () => ({ data: mockResearchAccess }),
  useGetStartupConfig: () => ({ data: { interface: { schedules: mockSchedulesConfig } } }),
}));

jest.mock('~/components/SidePanel/Schedules', () => ({ SchedulePanel: () => null }));

jest.mock('~/components/UnifiedSidebar/ConversationsSection', () => ({
  __esModule: true,
  default: () => null,
}));

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe('Coderax sidebar links', () => {
  beforeEach(() => {
    mockUser = { role: SystemRoles.ADMIN };
    mockResearchAccess = undefined;
    mockSchedulesConfig = undefined;
    mockHasAccess.mockReset().mockReturnValue(false);
  });

  it('keeps chat history and gives the owner Game Studio and Research destinations', () => {
    const { result } = renderHook(() => useUnifiedSidebarLinks(), { wrapper });
    expect(result.current.map((link) => link.id)).toEqual(['conversations', 'games', 'research']);
    expect(result.current[0].Component).toBeDefined();
    expect(result.current[1].onClick).toBeDefined();
  });

  it('omits Game Studio for a non-owner, whose routes reject them', () => {
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

  it.each([true, {}, { use: true }])('opens schedule management when opted in (%j)', (config) => {
    mockUser = { role: SystemRoles.USER };
    mockSchedulesConfig = config;
    mockHasAccess.mockReturnValue(true);
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
      mockSchedulesConfig = config;
      mockHasAccess.mockReturnValue(true);
      const { result } = renderHook(() => useUnifiedSidebarLinks(), { wrapper });
      expect(result.current.some((link) => link.id === 'schedules')).toBe(false);
    },
  );

  it('hides schedule management without schedule permission', () => {
    mockSchedulesConfig = true;
    const { result } = renderHook(() => useUnifiedSidebarLinks(), { wrapper });
    expect(result.current.some((link) => link.id === 'schedules')).toBe(false);
  });
});
