// client/src/components/UnifiedSidebar/__tests__/routeOverride.spec.tsx
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { COLLAPSED_WIDTH, EXPANDED_MIN } from '../constants';
import UnifiedSidebar from '../UnifiedSidebar';

/**
 * Desktop shell behavior driven by useRouteActiveId:
 * - On a workspace route (insights, cyvox-*), the panel stays collapsed even if the
 *   sidebar is expanded, because the route, not the stored panel, owns the content.
 * - Expanding from a workspace route leaves it (navigates to /c/new) first.
 * - The width re-clamps to the stored preference when the viewport or rem scale changes.
 */

const mockSidebarState = { isSmallScreen: false, expanded: true, setExpanded: jest.fn() };
const mockSetSidebarOpen = jest.fn();
const mockRemScale = { value: 1 };
const mockSidebarProps: { current: Record<string, unknown> } = { current: {} };

jest.mock('@coderax/client', () => ({
  useMediaQuery: () => false,
  useRemScale: () => mockRemScale.value,
  pxToRem: (px: number) => `${px / 16}rem`,
}));

jest.mock('~/hooks/Nav/useSidebarState', () => ({
  __esModule: true,
  default: () => mockSidebarState,
}));

jest.mock('~/hooks/Nav/useSidebarToggle', () => ({
  __esModule: true,
  default: () => ({ setSidebarOpen: mockSetSidebarOpen, toggleSidebar: jest.fn() }),
}));

jest.mock('~/hooks/Nav/useUnifiedSidebarLinks', () => ({
  __esModule: true,
  default: () => [],
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useChatHelpers: () => ({}),
  useShowMarketplace: () => false,
}));

jest.mock('~/Providers', () => ({
  ChatContext: { Provider: ({ children }: { children: ReactNode }) => <>{children}</> },
  ChatFormProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  ActivePanelProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

jest.mock('~/components/SidePanel/Nav', () => ({
  __esModule: true,
  default: () => <div data-testid="side-panel-nav" />,
}));

jest.mock('../mobile', () => ({
  MobileHeader: () => null,
  MobileBottomBar: () => null,
  MobileShortcutTargets: () => null,
}));

jest.mock('../Sidebar', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    mockSidebarProps.current = props;
    return <div data-testid="desktop-sidebar" />;
  },
}));

function LocationProbe() {
  const { pathname } = useLocation();
  return <div data-testid="location">{pathname}</div>;
}

const setViewport = (width: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
};

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <UnifiedSidebar switchToHistory={true} />
      <LocationProbe />
    </MemoryRouter>,
  );

const asideWidth = (container: HTMLElement) =>
  (container.querySelector('aside') as HTMLElement).style.width;

describe('UnifiedSidebar route override', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    mockSidebarState.expanded = true;
    mockRemScale.value = 1;
    setViewport(2000);
  });

  it('expands the panel off a workspace route', () => {
    const { container } = renderAt('/c/new');
    expect(mockSidebarProps.current.expanded).toBe(true);
    expect(asideWidth(container)).toBe(`${EXPANDED_MIN / 16}rem`);
  });

  it.each(['/insights', '/insights/reports', '/cyvox/robot'])(
    'keeps the panel collapsed on %s even when the sidebar is expanded',
    (path) => {
      const { container } = renderAt(path);
      expect(mockSidebarProps.current.expanded).toBe(false);
      expect(mockSidebarProps.current.width).toBe(COLLAPSED_WIDTH);
      expect(asideWidth(container)).toBe(`${COLLAPSED_WIDTH / 16}rem`);
    },
  );

  it('does not treat a bare /cyvox as a workspace route', () => {
    renderAt('/cyvox');
    expect(mockSidebarProps.current.expanded).toBe(true);
  });

  it('leaves the workspace route before expanding', () => {
    renderAt('/insights');
    act(() => (mockSidebarProps.current.onExpand as () => void)());
    expect(screen.getByTestId('location')).toHaveTextContent('/c/new');
    expect(mockSetSidebarOpen).toHaveBeenCalledWith(true);
  });

  it('expands on a non-workspace route without navigating', () => {
    renderAt('/c/new');
    act(() => (mockSidebarProps.current.onExpand as () => void)());
    expect(screen.getByTestId('location')).toHaveTextContent('/c/new');
    expect(mockSetSidebarOpen).toHaveBeenCalledWith(true);
  });
});

describe('UnifiedSidebar width re-clamping', () => {
  beforeEach(() => {
    localStorage.clear();
    mockSidebarState.expanded = true;
    mockRemScale.value = 1;
    setViewport(2000); // max = 800
  });

  it('shrinks to the new cap on a narrower viewport and restores on widening', () => {
    localStorage.setItem('side:width', '700');
    const { container } = renderAt('/c/new');
    expect(asideWidth(container)).toBe(`${700 / 16}rem`);

    act(() => {
      setViewport(1000); // max = 400
      window.dispatchEvent(new Event('resize'));
    });
    expect(asideWidth(container)).toBe(`${400 / 16}rem`);
    expect(mockSidebarProps.current.maxWidth).toBe(400);

    act(() => {
      setViewport(2000);
      window.dispatchEvent(new Event('resize'));
    });
    expect(asideWidth(container)).toBe(`${700 / 16}rem`);
  });

  it('re-clamps when the rem scale changes', () => {
    localStorage.setItem('side:width', '700');
    const { container, rerender } = renderAt('/c/new');

    mockRemScale.value = 2; // max = 400
    rerender(
      <MemoryRouter initialEntries={['/c/new']}>
        <UnifiedSidebar switchToHistory={false} />
        <LocationProbe />
      </MemoryRouter>,
    );
    expect(asideWidth(container)).toBe(`${400 / 16}rem`);
  });

  /**
   * A width persisted on a wider viewport exceeds the current cap
   * (innerWidth * 0.4 / remScale), so the first render clamps it. Clamping is
   * render-only: the stored preference is kept so widening can restore it.
   */
  it('clamps a persisted width to the viewport-based maximum on initial render', () => {
    localStorage.setItem('side:width', '1200'); // above max = 800
    const { container } = renderAt('/c/new');

    expect(asideWidth(container)).toBe(`${800 / 16}rem`);
    expect(mockSidebarProps.current.width).toBe(800);
    expect(mockSidebarProps.current.maxWidth).toBe(800);
    expect(localStorage.getItem('side:width')).toBe('1200');
  });

  /**
   * Stored values that are non-numeric, non-positive or below EXPANDED_MIN
   * render at the minimum. EXPANDED_MIN (360) stays under the cap (800) here.
   */
  it.each(['abc', '', '0', '-50', '100'])(
    'renders at the minimum for stored width %p',
    (stored) => {
      localStorage.setItem('side:width', stored);
      const { container } = renderAt('/c/new');
      expect(asideWidth(container)).toBe(`${EXPANDED_MIN / 16}rem`);
      expect(mockSidebarProps.current.width).toBe(EXPANDED_MIN);
    },
  );

  /**
   * On a viewport narrower than EXPANDED_MIN / 0.4 the cap (innerWidth * 0.4)
   * falls below EXPANDED_MIN, so the minimum yields to the cap: stored widths
   * both below and above EXPANDED_MIN render at the cap, and the announced
   * range collapses to that single value.
   */
  it.each(['100', '500'])(
    'yields the minimum to the cap on a narrow viewport for stored width %p',
    (stored) => {
      setViewport(800); // max = 320 < EXPANDED_MIN
      localStorage.setItem('side:width', stored);
      const { container } = renderAt('/c/new');

      expect(asideWidth(container)).toBe(`${320 / 16}rem`);
      expect(mockSidebarProps.current.width).toBe(320);
      expect(mockSidebarProps.current.minWidth).toBe(320);
      expect(mockSidebarProps.current.maxWidth).toBe(320);
      expect(localStorage.getItem('side:width')).toBe(stored);
    },
  );

  /**
   * Narrowing the viewport below EXPANDED_MIN / 0.4 while not dragging shrinks
   * the panel to the cap, under EXPANDED_MIN. Widening restores the stored width.
   */
  it('shrinks below EXPANDED_MIN on a narrow viewport and restores on widening', () => {
    localStorage.setItem('side:width', '500');
    const { container } = renderAt('/c/new');
    expect(asideWidth(container)).toBe(`${500 / 16}rem`);

    act(() => {
      setViewport(800); // max = 320
      window.dispatchEvent(new Event('resize'));
    });
    expect(asideWidth(container)).toBe(`${320 / 16}rem`);
    expect(mockSidebarProps.current.minWidth).toBe(320);

    act(() => {
      setViewport(2000); // max = 800
      window.dispatchEvent(new Event('resize'));
    });
    expect(asideWidth(container)).toBe(`${500 / 16}rem`);
    expect(mockSidebarProps.current.minWidth).toBe(EXPANDED_MIN);
    expect(localStorage.getItem('side:width')).toBe('500');
  });
});

/**
 * While dragging, the drag owns the width: the re-clamp effect is skipped, and
 * the width is written to localStorage on mouseup. rAF runs synchronously here
 * so each mousemove applies immediately.
 */
describe('UnifiedSidebar drag resizing', () => {
  let rafSpy: jest.SpyInstance;

  beforeEach(() => {
    localStorage.clear();
    mockSidebarState.expanded = true;
    mockRemScale.value = 1;
    setViewport(2000); // max = 800
    rafSpy = jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 1;
    });
  });

  afterEach(() => {
    rafSpy.mockRestore();
  });

  const startDrag = () =>
    act(() => (mockSidebarProps.current.onResizeStart as (e?: unknown) => void)());

  it('does not re-clamp sidebarWidth while resizing, then re-clamps on release', () => {
    localStorage.setItem('side:width', '700');
    const { container } = renderAt('/c/new');
    startDrag();

    act(() => {
      setViewport(1000); // max = 400
      window.dispatchEvent(new Event('resize'));
    });
    expect(asideWidth(container)).toBe(`${700 / 16}rem`);

    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup'));
    });
    expect(localStorage.getItem('side:width')).toBe('700');
    expect(asideWidth(container)).toBe(`${400 / 16}rem`);
  });

  it('persists the dragged width to localStorage on release', () => {
    const { container } = renderAt('/c/new');
    startDrag();

    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 500 }));
    });
    expect(asideWidth(container)).toBe(`${500 / 16}rem`);
    expect(localStorage.getItem('side:width')).toBeNull();

    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup'));
    });
    expect(localStorage.getItem('side:width')).toBe('500');
    expect(asideWidth(container)).toBe(`${500 / 16}rem`);
  });

  /**
   * A drag past the cap is clamped during mousemove, and mouseup persists that
   * clamped value, not the raw clientX. The shared `stop` then removes both
   * listeners, so later events no longer affect the width.
   */
  it('persists the clamped width on mouseup and removes the listeners', () => {
    const { container } = renderAt('/c/new');
    startDrag();

    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1500 })); // max = 800
    });
    expect(asideWidth(container)).toBe(`${800 / 16}rem`);

    const removeSpy = jest.spyOn(document, 'removeEventListener');
    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup'));
    });

    expect(localStorage.getItem('side:width')).toBe('800');
    const removed = removeSpy.mock.calls.map(([type]) => type);
    expect(removed).toEqual(expect.arrayContaining(['mousemove', 'mouseup']));
    expect(document.body.style.userSelect).toBe('');

    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 500 }));
    });
    expect(asideWidth(container)).toBe(`${800 / 16}rem`);
    expect(localStorage.getItem('side:width')).toBe('800');

    removeSpy.mockRestore();
  });

  /** A drag below EXPANDED_MIN is held at the minimum, and that minimum is what mouseup persists. */
  it('clamps a drag below the minimum and persists the minimum', () => {
    const { container } = renderAt('/c/new');
    startDrag();

    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100 }));
    });
    expect(asideWidth(container)).toBe(`${EXPANDED_MIN / 16}rem`);

    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup'));
    });
    expect(localStorage.getItem('side:width')).toBe(String(EXPANDED_MIN));
    expect(asideWidth(container)).toBe(`${EXPANDED_MIN / 16}rem`);
  });
});