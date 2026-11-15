// client/src/hooks/Nav/__tests__/useRouteActiveId.spec.tsx
import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import useRouteActiveId, { getRouteActiveId } from '../useRouteActiveId';

/**
 * routeActiveId decides which route-backed link (insights, cyvox-*) is active,
 * overriding the stored panel (effectiveActive) in the rail, switcher and
 * shortcut targets. `undefined` means the stored panel applies.
 */
describe('getRouteActiveId', () => {
  it.each([
    ['/insights', 'insights'],
    ['/insights/reports', 'insights'],
    ['/cyvox/robot', 'cyvox-robot'],
    ['/cyvox/readiness/extra', 'cyvox-readiness'],
  ])('maps %s to %s', (path, expected) => {
    expect(getRouteActiveId(path)).toBe(expected);
  });

  it.each(['/c/new', '/cyvox', '/workflows', '/'])('returns undefined for %s', (path) => {
    expect(getRouteActiveId(path)).toBeUndefined();
  });
});

describe('useRouteActiveId', () => {
  const renderAt = (path: string) =>
    renderHook(() => useRouteActiveId(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
      ),
    });

  it('reads the current location', () => {
    expect(renderAt('/cyvox/activity').result.current).toBe('cyvox-activity');
  });

  it('returns undefined off a workspace route', () => {
    expect(renderAt('/c/new').result.current).toBeUndefined();
  });
});