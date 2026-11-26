import { renderHook } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import useAppQueryClient from '../useAppQueryClient';

const reportError = (client: QueryClient, error: unknown) => {
  const cache = client.getQueryCache() as unknown as {
    config: { onError?: (error: unknown) => void };
  };
  cache.config.onError?.(error);
};

describe('useAppQueryClient', () => {
  it('keeps one client when the app re-renders', () => {
    const { result, rerender } = renderHook(({ handler }) => useAppQueryClient(handler), {
      initialProps: { handler: jest.fn() },
    });
    const client = result.current;

    rerender({ handler: jest.fn() });

    expect(result.current).toBe(client);
  });

  it('sends a 401 to the latest handler without replacing the client', () => {
    const first = jest.fn();
    const second = jest.fn();
    const { result, rerender } = renderHook(({ handler }) => useAppQueryClient(handler), {
      initialProps: { handler: first },
    });
    const client = result.current;

    rerender({ handler: second });
    reportError(client, Object.assign(new Error('Unauthorized'), { response: { status: 401 } }));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(client);
  });

  it('leaves other failures to the caller that made the request', () => {
    const handler = jest.fn();
    const { result } = renderHook(() => useAppQueryClient(handler));

    reportError(
      result.current,
      Object.assign(new Error('Server error'), { response: { status: 500 } }),
    );

    expect(handler).not.toHaveBeenCalled();
  });
});
