import { render, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { QueryClient as QueryClientType } from '@tanstack/react-query';
import useAppQueryClient from '../useAppQueryClient';

const reportError = (client: QueryClientType, error: unknown) => {
  const cache = client.getQueryCache() as unknown as {
    config: { onError?: (error: unknown) => void };
  };
  cache.config.onError?.(error);
};

describe('useAppQueryClient', () => {
  it('keeps one client when the app re-renders', () => {
    const { result, rerender } = renderHook(
      ({ handler }: { handler: (error: unknown) => void }) => useAppQueryClient(handler),
      { initialProps: { handler: jest.fn() } },
    );
    const client = result.current;

    rerender({ handler: jest.fn() });

    expect(result.current).toBe(client);
  });

  it('sends a 401 to the latest handler without replacing the client', () => {
    const first = jest.fn();
    const second = jest.fn();
    const { result, rerender } = renderHook(
      ({ handler }: { handler: (error: unknown) => void }) => useAppQueryClient(handler),
      { initialProps: { handler: first } },
    );
    const client = result.current;

    rerender({ handler: second });
    reportError(client, Object.assign(new Error('Unauthorized'), { response: { status: 401 } }));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(client);
  });

  it('keeps cached conversation data across an auth-boundary rerender', () => {
    const { result, rerender } = renderHook(
      ({ handler }: { handler: (error: unknown) => void }) => useAppQueryClient(handler),
      { initialProps: { handler: jest.fn() } },
    );
    const client = result.current;
    client.setQueryData(['conversation', 'kept'], { conversationId: 'kept' });

    for (let rerenderCount = 0; rerenderCount < 5; rerenderCount += 1) {
      rerender({ handler: jest.fn() });
    }

    expect(result.current.getQueryData(['conversation', 'kept'])).toEqual({
      conversationId: 'kept',
    });
  });

  it('measures one startup request across repeated auth-boundary rerenders', async () => {
    const request = jest.fn().mockResolvedValue('loaded');
    const Probe = () => {
      useQuery({ queryKey: ['startup-probe'], queryFn: request, staleTime: Infinity });
      return null;
    };
    /* An auth-boundary render can replace the mounted tree; the stable cache
       must survive that remount instead of refetching startup data. */
    const Stable = ({ revision }: { revision: number }) => {
      const client = useAppQueryClient(jest.fn());
      return (
        <QueryClientProvider client={client}>
          <Probe key={revision} />
        </QueryClientProvider>
      );
    };

    const { rerender } = render(<Stable revision={0} />);

    for (let revision = 1; revision <= 4; revision += 1) {
      rerender(<Stable revision={revision} />);
    }

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('shows the request storm the per-render client caused', async () => {
    const request = jest.fn().mockResolvedValue('loaded');
    const Probe = () => {
      useQuery({ queryKey: ['startup-probe'], queryFn: request, staleTime: Infinity });
      return null;
    };
    const Rebuilt = ({ revision }: { revision: number }) => {
      /* What App did before the fix: a new cache on every render, so every
         remount starts from nothing. */
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      return (
        <QueryClientProvider client={client}>
          <Probe key={revision} />
        </QueryClientProvider>
      );
    };

    const { rerender } = render(<Rebuilt revision={0} />);

    for (let revision = 1; revision <= 4; revision += 1) {
      rerender(<Rebuilt revision={revision} />);
    }

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(request.mock.calls.length).toBe(5);
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
