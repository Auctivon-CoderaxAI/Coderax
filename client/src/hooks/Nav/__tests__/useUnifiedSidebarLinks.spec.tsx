import { MemoryRouter } from 'react-router-dom';
import { renderHook } from '@testing-library/react';
import { SystemRoles } from 'coderax-data-provider';
import type { ReactNode } from 'react';
import useUnifiedSidebarLinks from '../useUnifiedSidebarLinks';

let mockUser: { role: SystemRoles } = { role: SystemRoles.ADMIN };

jest.mock('~/hooks', () => ({
  useAuthContext: () => ({ user: mockUser }),
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
  });

  it('keeps chat history and gives the owner a Game Studio destination', () => {
    const { result } = renderHook(() => useUnifiedSidebarLinks(), { wrapper });
    expect(result.current.map((link) => link.id)).toEqual(['conversations', 'games']);
    expect(result.current[0].Component).toBeDefined();
    expect(result.current[1].onClick).toBeDefined();
  });

  it('omits Game Studio for a non-owner, whose routes reject them', () => {
    mockUser = { role: SystemRoles.USER };
    const { result } = renderHook(() => useUnifiedSidebarLinks(), { wrapper });
    expect(result.current.map((link) => link.id)).toEqual(['conversations']);
  });
});
