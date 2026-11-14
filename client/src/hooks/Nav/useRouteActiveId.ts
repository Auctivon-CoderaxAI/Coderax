import { useLocation } from 'react-router-dom';

/**
 * Route-backed sidebar links (insights, cyvox-*) are active because of the URL,
 * not the stored panel. Returns the link id the current path selects, or
 * `undefined` when the path is not a workspace route.
 */
export function getRouteActiveId(pathname: string): string | undefined {
  if (pathname.startsWith('/insights')) {
    return 'insights';
  }
  if (pathname.startsWith('/cyvox/')) {
    return `cyvox-${pathname.split('/')[2]}`;
  }
  return undefined;
}

export default function useRouteActiveId(): string | undefined {
  const { pathname } = useLocation();
  return getRouteActiveId(pathname);
}