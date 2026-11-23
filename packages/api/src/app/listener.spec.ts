import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveApiListener } from './listener';

describe('resolveApiListener', () => {
  it('exposes the named export to stock Node before the API package is built', () => {
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        "import { resolveApiListener } from './packages/api/src/app/listener/index.ts'; resolveApiListener({});",
      ],
      { cwd: path.resolve(__dirname, '../../../..'), encoding: 'utf8' },
    );
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

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
