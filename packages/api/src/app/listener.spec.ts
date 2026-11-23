import { resolveListenerHost } from './listener';

describe('resolveListenerHost', () => {
  it.each([
    [{}, 'localhost'],
    [{ VERCEL: '1' }, '0.0.0.0'],
    [{ CODERAX_LOCAL_DEV: '1' }, '127.0.0.1'],
    [{ VERCEL: '1', CODERAX_LOCAL_DEV: '1', HOST: '' }, '127.0.0.1'],
    [{ VERCEL: '1', HOST: 'localhost' }, 'localhost'],
    [{ VERCEL: '1', CODERAX_LOCAL_DEV: '1', HOST: '::1' }, '::1'],
  ])('selects the listener host for %j', (env, expected) => {
    expect(resolveListenerHost(env)).toBe(expected);
  });
});
