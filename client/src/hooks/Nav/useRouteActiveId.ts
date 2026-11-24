import { useLocation } from 'react-router-dom';

/**
 * Route-backed sidebar links (insights, cyvox-*, games) are active because of
 * the URL, not the stored panel. Returns the link id the current path selects,
 * or `undefined` when the path is not a route-backed link.
 */
export function getRouteActiveId(pathname: string): string | undefined {
  if (pathname.startsWith('/insights')) {
    return 'insights';
  }
  if (pathname.startsWith('/cyvox/')) {
    return `cyvox-${pathname.split('/')[2]}`;
  }
  if (pathname === '/games' || pathname.startsWith('/games/')) {
    return 'games';
  }
  return undefined;
}

/**
 * Workspace routes own the main pane: the sidebar collapses on them and its
 * expand toggle leaves for a new chat. Game Studio is route-backed but keeps
 * the ordinary shell, so it is not a workspace route.
 */
export function isWorkspaceRoute(pathname: string): boolean {
  return pathname.startsWith('/insights') || pathname.startsWith('/cyvox/');
}

export function useIsWorkspaceRoute(): boolean {
  const { pathname } = useLocation();
  return isWorkspaceRoute(pathname);
}

export default function useRouteActiveId(): string | undefined {
  const { pathname } = useLocation();
  return getRouteActiveId(pathname);
}
