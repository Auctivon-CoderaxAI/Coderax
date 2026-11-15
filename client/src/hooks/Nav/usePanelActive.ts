import { useContext } from 'react';
import { useRecoilValue } from 'recoil';
import { ActivePanelContext, useActivePanel } from '~/Providers/ActivePanelContext';
import useRouteActiveId from './useRouteActiveId';
import store from '~/store';

/**
 * Whether the panel with `panelId` is both selected and actually visible.
 *
 * Panels stay mounted while the sidebar is hidden (collapsed, mobile drawer
 * closed, or a workspace route such as insights / cyvox-* collapsing it), so
 * selection alone is not enough. This mirrors UnifiedSidebar's
 * `panelExpanded`: atom AND not a workspace route.
 *
 * Must be used within an ActivePanelProvider.
 */
export default function usePanelActive(panelId: string): boolean {
  const { active } = useActivePanel();
  const sidebarExpanded = useRecoilValue(store.sidebarExpanded);
  const routeActiveId = useRouteActiveId();

  return active === panelId && sidebarExpanded && routeActiveId == null;
}

/** Returns the active panel id, or `undefined` when no ActivePanelProvider is mounted. */
function useOptionalActivePanelId(): string | undefined {
  return useContext(ActivePanelContext)?.active;
}

/**
 * Non-throwing variant of `usePanelActive`.
 *
 * Outside an ActivePanelProvider (e.g. a standalone route layout) the panel is
 * the page itself, so it is treated as active and `true` is returned.
 * Inside a provider it behaves exactly like `usePanelActive`.
 */
export function useOptionalPanelActive(panelId: string): boolean {
  const active = useOptionalActivePanelId();
  const sidebarExpanded = useRecoilValue(store.sidebarExpanded);
  const routeActiveId = useRouteActiveId();

  if (active === undefined) {
    return true;
  }
  return active === panelId && sidebarExpanded && routeActiveId == null;
}