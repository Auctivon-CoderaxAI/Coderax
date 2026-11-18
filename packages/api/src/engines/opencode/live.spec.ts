import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveOpenCodeSdkEntry } from './sdk';

const execFileAsync = promisify(execFile);

/**
 * Live transport check against an operator-run `opencode serve`.
 *
 * It is opt-in so the normal suite needs neither a server nor a network:
 *
 *   OPENCODE_E2E=1 OPENCODE_E2E_URL=http://127.0.0.1:4096 \
 *     npx jest src/engines/opencode/live.spec.ts
 *
 * The SDK is ESM-only, and Jest's CommonJS loader cannot load it. The check
 * therefore runs the pinned entry in a native Node child process, which is the
 * same loader the API process uses. It verifies session creation, the
 * `server.connected` readiness frame, and abort without sending a prompt; a
 * prompt would need a provider credential, which the owner supplies separately.
 */
const runLive = process.env.OPENCODE_E2E === '1' ? describe : describe.skip;

runLive('OpenCode live transport', () => {
  const baseURL = process.env.OPENCODE_E2E_URL ?? 'http://127.0.0.1:4096';

  it('creates a session, receives server.connected, and aborts it', async () => {
    const entry = resolveOpenCodeSdkEntry();
    expect(entry).toBeTruthy();
    if (!entry) {
      return;
    }
    const script = `
const { createOpencodeClient } = require(process.argv[1]);
(async () => {
  const [, , baseURL, directory] = process.argv;
  const client = createOpencodeClient({ baseUrl: baseURL });
  const session = await client.session.create({
    body: { title: 'coderax-live-transport' },
    query: { directory },
  });
  if (!session?.data?.id) throw new Error('no session id');
  const controller = new AbortController();
  const subscription = await client.event.subscribe({
    query: { directory },
    signal: controller.signal,
  });
  const iterator = subscription.stream[Symbol.asyncIterator]();
  const first = await iterator.next();
  if (first.value?.type !== 'server.connected') {
    throw new Error('unexpected first event: ' + JSON.stringify(first.value));
  }
  controller.abort();
  await iterator.return?.();
  await client.session.abort({ path: { id: session.data.id }, query: { directory } });
  console.log(JSON.stringify({ id: session.data.id, first: first.value.type }));
})().catch((error) => {
  console.error(error?.message ?? String(error));
  process.exit(1);
});
`;
    const { stdout } = await execFileAsync(
      process.execPath,
      ['-e', script, entry, baseURL, process.cwd()],
      { timeout: 30_000 },
    );
    expect(JSON.parse(stdout.trim())).toMatchObject({ first: 'server.connected' });
  }, 40_000);
});
