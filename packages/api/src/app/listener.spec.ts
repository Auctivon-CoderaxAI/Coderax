import { resolveApiListener } from './listener';

describe('resolveApiListener', () => {
  it.each([
    [{}, 'localhost', 3080],
    [{ VERCEL: '1' }, '0.0.0.0', 3080],
    [{ VERCEL: '1', CODERAX_LOCAL_DEV: '1' }, '127.0.0.1', 3080],
    [{ CODERAX_LOCAL_DEV: '1', HOST: '::1', PORT: '4180' }, '::1', 4180],
    [{ VERCEL: '1', HOST: '127.0.0.2', PORT: '0' }, '127.0.0.2', 0],
    [{ PORT: 'invalid' }, 'localhost', 3080],
  ])('resolves %j to %s:%i', (env, host, port) => {
    expect(resolveApiListener(env)).toEqual({ host, port });
  });
});
