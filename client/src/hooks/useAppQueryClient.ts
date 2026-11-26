import { useRef, useState } from 'react';
import { QueryCache } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';

type UnauthorizedHandler = (error: unknown) => void;

const isUnauthorized = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const response = (error as { response?: { status?: unknown } }).response;
  return response?.status === 401;
};

const createAppQueryClient = (onUnauthorized: UnauthorizedHandler): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        // Always attempt network requests, even when navigator.onLine is false
        // This is needed because localhost is reachable without WiFi
        networkMode: 'always',
      },
      mutations: {
        networkMode: 'always',
      },
    },
    queryCache: new QueryCache({
      onError: (error) => {
        if (isUnauthorized(error)) {
          onUnauthorized(error);
        }
      },
    }),
  });

/**
 * One query client for the lifetime of the app.
 *
 * Building the client during render replaces the cache on every App render, and
 * the auth error boundary deliberately re-renders App when a request returns
 * 401. That would drop every cached conversation and restart the requests the
 * startup path had already resolved. The initializer keeps the client stable,
 * while the ref keeps the 401 handler current without rebuilding it.
 */
export default function useAppQueryClient(
  onUnauthorized: UnauthorizedHandler,
): QueryClient {
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;
  const [queryClient] = useState(() =>
    createAppQueryClient((error) => onUnauthorizedRef.current(error)),
  );
  return queryClient;
}
