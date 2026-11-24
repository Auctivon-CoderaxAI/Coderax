// client/src/hooks/Nav/__tests__/useOptionalPanelActive.spec.tsx
import { RecoilRoot } from 'recoil';
import { MemoryRouter } from 'react-router-dom';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ActivePanelProvider, useActivePanel } from '~/Providers/ActivePanelContext';
import { useOptionalPanelActive } from '../usePanelActive';
import store from '~/store';

const STORAGE_KEY = 'side:active-panel';

const makeWrapper = ({
  withProvider = true,
  active = 'prompts',
  expanded = true,
  path = '/c/new',
}: { withProvider?: boolean; active?: string; expanded?: boolean; path?: string } = {}) => {
  localStorage.setItem(STORAGE_KEY, active);
  return ({ children }: { children: ReactNode }) => (
    <RecoilRoot initializeState={({ set }) => set(store.sidebarExpanded, expanded)}>
      <MemoryRouter initialEntries={[path]}>
        {withProvider ? <ActivePanelProvider>{children}</ActivePanelProvider> : children}
      </MemoryRouter>
    </RecoilRoot>
  );
};

const render = (options: Parameters<typeof makeWrapper>[0] = {}) =>
  renderHook(() => useOptionalPanelActive('prompts'), { wrapper: makeWrapper(options) }).result
    .current;

/** Renders the hook alongside the panel context so tests can switch panels. */
const renderWithPanel = (options: Parameters<typeof makeWrapper>[0] = {}) =>
  renderHook(() => ({ isActive: useOptionalPanelActive('prompts'), panel: useActivePanel() }), {
    wrapper: makeWrapper(options),
  });

describe('useOptionalPanelActive', () => {
  beforeEach(() => localStorage.clear());

  it('returns true without an ActivePanelProvider', () => {
    expect(render({ withProvider: false })).toBe(true);
  });

  it('returns true without a provider even when the sidebar is collapsed', () => {
    expect(render({ withProvider: false, expanded: false })).toBe(true);
  });

  it('matches usePanelActive inside a provider', () => {
    expect(render()).toBe(true);
    expect(render({ active: 'mcp-builder' })).toBe(false);
    expect(render({ expanded: false })).toBe(false);
  });

  // Inside a provider, workspace routes hide the sidebar panel even when it is selected.
  it.each(['/insights', '/insights/reports', '/cyvox/robot'])(
    'is false inside a provider on workspace route %s',
    (path) => {
      expect(render({ path })).toBe(false);
    },
  );

  // Game Studio is route-backed but keeps the ordinary shell, so the panel stays visible.
  it.each(['/games', '/games/lantern-run'])('is true inside a provider on %s', (path) => {
    expect(render({ path })).toBe(true);
  });

  // Without a provider the panel is the page itself, so route visibility is ignored.
  it.each(['/insights', '/cyvox/robot'])(
    'returns true without a provider on workspace route %s',
    (path) => {
      expect(render({ withProvider: false, path })).toBe(true);
    },
  );

  it('reflects active panel changes inside a provider', () => {
    const { result } = renderWithPanel({ active: 'mcp-builder' });
    expect(result.current.isActive).toBe(false);

    act(() => result.current.panel.setActive('prompts'));
    expect(result.current.isActive).toBe(true);

    act(() => result.current.panel.setActive('bookmarks'));
    expect(result.current.isActive).toBe(false);
  });
});
