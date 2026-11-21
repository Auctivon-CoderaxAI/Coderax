import { renderHook } from '@testing-library/react';
import useUnifiedSidebarLinks from '../useUnifiedSidebarLinks';

jest.mock('~/components/UnifiedSidebar/ConversationsSection', () => ({
  __esModule: true,
  default: () => null,
}));

describe('Coderax sidebar links', () => {
  it('keeps chat history and excludes unrelated application launchers', () => {
    const { result } = renderHook(() => useUnifiedSidebarLinks());
    expect(result.current.map((link) => link.id)).toEqual(['conversations']);
    expect(result.current[0].Component).toBeDefined();
  });
});
