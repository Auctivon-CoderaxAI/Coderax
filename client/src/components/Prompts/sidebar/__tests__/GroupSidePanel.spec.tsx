// client/src/components/Prompts/sidebar/__tests__/GroupSidePanel.spec.tsx
import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { MemoryRouter } from 'react-router-dom';
import { render } from '@testing-library/react';
import GroupSidePanel from '../GroupSidePanel';

/**
 * GroupSidePanel gates its prompt-groups work on useOptionalPanelActive('prompts'):
 * - catalog release (activateCatalog) only while the panel is visible
 * - page draining (useNavScrolling `enabled`) only while the panel is visible
 * isChatRoute is still derived from the route (or the prop), independent of visibility.
 */
const mockPanelActive = jest.fn(() => true);
const mockActivateCatalog = jest.fn();
const mockUseNavScrolling = jest.fn((_options?: object) => ({ containerRef: { current: null } }));
const mockListProps = jest.fn();

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useNavScrolling: (options: object) => mockUseNavScrolling(options),
  activateCatalog: (id: string) => mockActivateCatalog(id),
  useOptionalPanelActive: (id: string) => mockPanelActive(id),
}));

jest.mock('~/Providers', () => ({
  usePromptGroupsContext: () => ({
    promptGroups: [],
    groupsQuery: { isLoading: false },
    nextCursor: 'cursor-2',
    isFetchingNextPage: false,
    fetchNextPage: jest.fn(),
  }),
}));

jest.mock('@coderax/client', () => ({
  Button: () => null,
  Sidebar: () => null,
  Spinner: () => null,
  TooltipAnchor: () => null,
}));

jest.mock('~/components/ui', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  const PanelContent = ReactModule.forwardRef<HTMLDivElement, { children?: React.ReactNode }>(
    ({ children }, ref) => <div ref={ref}>{children}</div>,
  );
  return { PanelContent };
});

jest.mock('../../lists/PromptGroupSkeleton', () => ({ __esModule: true, default: () => null }));
jest.mock('../../lists/List', () => ({
  __esModule: true,
  default: (props: object) => {
    mockListProps(props);
    return null;
  },
}));

const renderAt = (path = '/c/new', props: { isChatRoute?: boolean } = {}) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <GroupSidePanel {...props} />
    </MemoryRouter>,
  );

describe('GroupSidePanel visibility gating', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPanelActive.mockReturnValue(true);
  });

  it('asks for the prompts panel specifically', () => {
    renderAt();
    expect(mockPanelActive).toHaveBeenCalledWith('prompts');
  });

  it('releases the catalog and paginates while the prompts panel is active', () => {
    renderAt();
    expect(mockActivateCatalog).toHaveBeenCalledWith('prompts');
    expect(mockUseNavScrolling).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: true }),
    );
  });

  it('does not release the catalog or paginate while the prompts panel is inactive', () => {
    mockPanelActive.mockReturnValue(false);
    renderAt();
    expect(mockActivateCatalog).not.toHaveBeenCalled();
    expect(mockUseNavScrolling).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false }),
    );
  });

  it('keeps isChatRoute route-derived regardless of visibility', () => {
    mockPanelActive.mockReturnValue(false);
    renderAt('/c/abc');
    expect(mockListProps).toHaveBeenLastCalledWith(expect.objectContaining({ isChatRoute: true }));

    renderAt('/prompts');
    expect(mockListProps).toHaveBeenLastCalledWith(expect.objectContaining({ isChatRoute: false }));

    renderAt('/prompts', { isChatRoute: true });
    expect(mockListProps).toHaveBeenLastCalledWith(expect.objectContaining({ isChatRoute: true }));
  });
});