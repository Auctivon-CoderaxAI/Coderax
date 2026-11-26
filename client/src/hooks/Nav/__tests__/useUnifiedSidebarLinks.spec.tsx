import { MemoryRouter } from 'react-router-dom';
import { renderHook } from '@testing-library/react';
import { SystemRoles } from 'coderax-data-provider';
import type { ReactNode } from 'react';
import useUnifiedSidebarLinks from '../useUnifiedSidebarLinks';

let mockUser: { role: SystemRoles } = { role: SystemRoles.ADMIN };
let mockScheduleAccess = false;
let mockResearchAccess: { canAccess: boolean } | undefined;

jest.mock('~/hooks', () => ({
  useAuthContext: () => ({ user: mockUser }),
  useHasAccess: () => mockScheduleAccess,
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: { interface: { schedules: true } } }),
  useResearchCapabilitiesQuery: () => ({ data: mockResearchAccess }),
}));

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
    mockScheduleAccess = false;
  });

  it('keeps chat history and gives the owner Game Studio and Research destinations', () => {
    mockScheduleAccess = true;
    const { result } = renderHook(() => useUnifiedSidebarLinks(), { wrapper });
    expect(result.current.map((link) => link.id)).toEqual([
      'conversations',
      'schedules',
      'plugins',
      'games',
      'research',
    ]);
    expect(result.current[0].Component).toBeDefined();
    expect(result.current.find((link) => link.id === 'games')?.onClick).toBeDefined();
  });

  it('omits Game Studio for a non-owner, whose routes reject them', () => {
    mockUser = { role: SystemRoles.USER };
    const { result } = renderHook(() => useUnifiedSidebarLinks(), { wrapper });
    expect(result.current.map((link) => link.id)).toEqual(['conversations', 'plugins']);
  });

  it('follows the advertised research policy without exposing Game Studio', () => {
    mockUser = { role: SystemRoles.USER };
    mockResearchAccess = { canAccess: true };
    const { result } = renderHook(() => useUnifiedSidebarLinks(), { wrapper });
    expect(result.current.map((link) => link.id)).toEqual(['conversations', 'plugins', 'research']);
  });
});
