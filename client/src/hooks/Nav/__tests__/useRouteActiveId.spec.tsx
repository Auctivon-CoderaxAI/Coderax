// client/src/hooks/Nav/__tests__/useRouteActiveId.spec.tsx
import { MemoryRouter } from 'react-router-dom';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import useRouteActiveId, {
  getRouteActiveId,
  isWorkspaceRoute,
  useIsWorkspaceRoute,
} from '../useRouteActiveId';

/**
 * routeActiveId decides which route-backed link (insights, cyvox-*, games) is
 * active, overriding the stored panel (effectiveActive) in the rail, switcher
 * and shortcut targets. `undefined` means the stored panel applies.
 */
describe('getRouteActiveId', () => {
  it.each([
    ['/insights', 'insights'],
    ['/insights/reports', 'insights'],
    ['/cyvox/robot', 'cyvox-robot'],
    ['/cyvox/readiness/extra', 'cyvox-readiness'],
    ['/games', 'games'],
    ['/games/new', 'games'],
    ['/games/templates', 'games'],
    ['/games/lantern-run', 'games'],
  ])('maps %s to %s', (path, expected) => {
    expect(getRouteActiveId(path)).toBe(expected);
  });

  it.each(['/c/new', '/cyvox', '/workflows', '/', '/games-old'])(
    'returns undefined for %s',
    (path) => {
      expect(getRouteActiveId(path)).toBeUndefined();
    },
  );
});

/**
 * Only insights and cyvox-* own the main pane. Game Studio is route-backed but
 * keeps the ordinary shell: the expanded panel stays, and expanding it does not
 * navigate to a new chat.
 */
describe('isWorkspaceRoute', () => {
  it.each(['/insights', '/insights/reports', '/cyvox/robot'])(
    'treats %s as a workspace route',
    (path) => {
      expect(isWorkspaceRoute(path)).toBe(true);
    },
  );

  it.each(['/games', '/games/new', '/games/lantern-run', '/c/new', '/cyvox', '/'])(
    'keeps the ordinary shell on %s',
    (path) => {
      expect(isWorkspaceRoute(path)).toBe(false);
    },
  );
});

const wrapperAt = (path: string) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>;
  };

describe('useRouteActiveId', () => {
  const renderAt = (path: string) =>
    renderHook(() => useRouteActiveId(), { wrapper: wrapperAt(path) });

  it('reads the current location', () => {
    expect(renderAt('/cyvox/activity').result.current).toBe('cyvox-activity');
  });

  it('marks the games link on a nested Game Studio route', () => {
    expect(renderAt('/games/lantern-run').result.current).toBe('games');
  });

  it('returns undefined off a route-backed link', () => {
    expect(renderAt('/c/new').result.current).toBeUndefined();
  });
});

describe('useIsWorkspaceRoute', () => {
  const renderAt = (path: string) =>
    renderHook(() => useIsWorkspaceRoute(), { wrapper: wrapperAt(path) });

  it.each(['/insights', '/insights/reports', '/cyvox/robot'])('is true on %s', (path) => {
    expect(renderAt(path).result.current).toBe(true);
  });

  it.each(['/games', '/games/lantern-run', '/c/new'])('is false on %s', (path) => {
    expect(renderAt(path).result.current).toBe(false);
  });
});
