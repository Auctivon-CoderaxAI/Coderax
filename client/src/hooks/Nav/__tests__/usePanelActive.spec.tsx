// client/src/hooks/Nav/__tests__/usePanelActive.spec.tsx
import { RecoilRoot } from 'recoil';
import { MemoryRouter } from 'react-router-dom';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ActivePanelProvider, useActivePanel } from '~/Providers/ActivePanelContext';
import usePanelActive from '../usePanelActive';
import store from '~/store';

const STORAGE_KEY = 'side:active-panel';

const renderAt = ({
  path = '/c/new',
  active = 'mcp-builder',
  expanded = true,
}: { path?: string; active?: string; expanded?: boolean } = {}) => {
  localStorage.setItem(STORAGE_KEY, active);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <RecoilRoot initializeState={({ set }) => set(store.sidebarExpanded, expanded)}>
      <MemoryRouter initialEntries={[path]}>
        <ActivePanelProvider>{children}</ActivePanelProvider>
      </MemoryRouter>
    </RecoilRoot>
  );
  return renderHook(() => ({ isActive: usePanelActive('mcp-builder'), panel: useActivePanel() }), {
    wrapper,
  });
};

describe('usePanelActive', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('is true when the panel is selected and the sidebar is visible', () => {
    expect(renderAt().result.current.isActive).toBe(true);
  });

  it('is false when another panel is selected', () => {
    expect(renderAt({ active: 'prompts' }).result.current.isActive).toBe(false);
  });

  it('is false when the sidebar is collapsed', () => {
    expect(renderAt({ expanded: false }).result.current.isActive).toBe(false);
  });

  it.each(['/insights', '/insights/reports', '/cyvox/robot'])(
    'is false on workspace route %s',
    (path) => {
      expect(renderAt({ path }).result.current.isActive).toBe(false);
    },
  );

  // Game Studio is route-backed but keeps the ordinary shell, so the panel stays visible.
  it.each(['/games', '/games/lantern-run'])('stays active on %s', (path) => {
    expect(renderAt({ path }).result.current.isActive).toBe(true);
  });

  it('updates when the active panel changes', () => {
    const { result } = renderAt({ active: 'prompts' });
    expect(result.current.isActive).toBe(false);

    act(() => result.current.panel.setActive('mcp-builder'));
    expect(result.current.isActive).toBe(true);
  });

  it('throws outside an ActivePanelProvider', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      renderHook(() => usePanelActive('mcp-builder'), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <RecoilRoot>
            <MemoryRouter>{children}</MemoryRouter>
          </RecoilRoot>
        ),
      }),
    ).toThrow('useActivePanel must be used within an ActivePanelProvider');
    spy.mockRestore();
  });
});
