import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, test } from 'node:test';

import { runCli } from '../src/cli.js';

let configDir;
let savedEnv;

before(() => {
  savedEnv = process.env.CODERAX_CONFIG_DIR;
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coderax-cli-'));
});

after(() => {
  fs.rmSync(configDir, { recursive: true, force: true });
  if (savedEnv === undefined) {
    delete process.env.CODERAX_CONFIG_DIR;
  } else {
    process.env.CODERAX_CONFIG_DIR = savedEnv;
  }
});

beforeEach(() => {
  fs.rmSync(configDir, { recursive: true, force: true });
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(configDir, 0o700);
  delete process.env.CODERAX_TOKEN;
  delete process.env.CODERAX_BASE_URL;
});

function harness({ fetchImpl, signal } = {}) {
  const env = { ...process.env, CODERAX_CONFIG_DIR: configDir };
  // Each run gets a clean buffer so assertions never see a previous command's
  // output; `stdout` and `stderr` always describe the most recent run.
  let stdout = '';
  let stderr = '';
  const run = (argv) => {
    stdout = '';
    stderr = '';
    return runCli(argv, {
      env,
      fetchImpl,
      signal,
      stdinIsTTY: true,
      stdout: { write: (chunk) => { stdout += chunk; return true; } },
      stderr: { write: (chunk) => { stderr += chunk; return true; } },
    });
  };
  return {
    run,
    get stdout() { return stdout; },
    get stderr() { return stderr; },
  };
}

function seedCredentials(token = 'secret-token-value-1234') {
  fs.writeFileSync(
    path.join(configDir, 'credentials.json'),
    JSON.stringify({ token, account: 'dev@coderax.test' }),
    { mode: 0o600 },
  );
}

function sseResponse(chunks, { status = 200 } = {}) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

test('products lists five products as JSON', async () => {
  const h = harness();
  const code = await h.run(['products', '--json']);
  assert.equal(code, 0);
  const parsed = JSON.parse(h.stdout);
  assert.equal(parsed.products.length, 5);
  assert.deepEqual(
    parsed.products.map((product) => product.id),
    ['desktop', 'cli', 'web', 'cloud', 'chat'],
  );
});

test('products marks Cloud as unavailable in plain output', async () => {
  const h = harness();
  assert.equal(await h.run(['products']), 0);
  assert.match(h.stdout, /Cloud/);
  assert.match(h.stdout, /In development/);
  assert.match(h.stdout, /nothing is billed/i);
});

test('--version prints the package version', async () => {
  const h = harness();
  assert.equal(await h.run(['--version']), 0);
  assert.match(h.stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test('unknown command exits with the usage code', async () => {
  const h = harness();
  assert.equal(await h.run(['warp-speed']), 2);
  assert.match(h.stderr, /unknown command/);
});

test('unknown option exits with the usage code', async () => {
  const h = harness();
  assert.equal(await h.run(['products', '--turbo']), 2);
  assert.match(h.stderr, /Unknown option/);
});

// --- parseArgs coverage (exercised through runCli; parseArgs is not exported) ---

test('parseArgs: inline "=" value is applied to the flag', async () => {
  // `--base-url=<url>` should behave like `--base-url <url>`.
  const h = harness();
  assert.equal(await h.run(['status', '--json', '--base-url=https://example.test']), 0);
  assert.equal(JSON.parse(h.stdout).baseUrl, 'https://example.test');
});

test('parseArgs: inline value containing "=" is truncated (known quirk)', async () => {
  // Documents current behaviour: split('=') keeps only the first segment, so the
  // query value "=b" is lost. Flip this assertion once the parsing fix lands
  // (expected: 'https://example.test/x?a=b').
  const h = harness();
  assert.equal(await h.run(['status', '--json', '--base-url=https://example.test/x?a=b']), 0);
  assert.equal(JSON.parse(h.stdout).baseUrl, 'https://example.test/x?a');
});

test('parseArgs: single-dash value is consumed as the flag value', async () => {
  // Only "--" prefixes stop value consumption, so "-fast" becomes the model.
  const h = harness();
  assert.equal(await h.run(['status', '--json', '--model', '-fast']), 0);
  assert.equal(JSON.parse(h.stdout).model, '-fast');
});

test('parseArgs: "-h" after a value-taking flag is a value, not the help alias', async () => {
  // The flag branch reads argv[index + 1] directly and never reaches the alias check.
  const h = harness();
  assert.equal(await h.run(['status', '--json', '--model', '-h']), 0);
  const parsed = JSON.parse(h.stdout);
  assert.equal(parsed.model, '-h');
  assert.doesNotMatch(h.stdout, /Usage: coderax/);
});

test('parseArgs: a flag followed by another "--" flag becomes boolean true', async () => {
  // `--model` gets `true`, which buildContext ignores because it is not a string.
  const h = harness();
  assert.equal(await h.run(['status', '--model', '--json']), 0);
  const parsed = JSON.parse(h.stdout);
  assert.equal(parsed.model, process.env.CODERAX_MODEL ?? null);
});

test('parseArgs: unknown inline flag is rejected with a hint', async () => {
  const h = harness();
  assert.equal(await h.run(['products', '--turbo=1']), 2);
  assert.match(h.stderr, /error: Unknown option "--turbo"\./);
  assert.match(h.stderr, /hint: Run `coderax --help`/);
  assert.equal(h.stdout, '');
});

test('parseArgs: unknown flag before the command is rejected before dispatch', async () => {
  const h = harness();
  assert.equal(await h.run(['--nope', 'products']), 2);
  assert.match(h.stderr, /Unknown option "--nope"/);
  assert.equal(h.stdout, '');
});

test('parseArgs: --no-color is accepted and does not consume the next argument', async () => {
  // `--no-color` is handled before value consumption, so "status" stays positional.
  const h = harness();
  assert.equal(await h.run(['--no-color', 'status', '--json']), 0);
  assert.equal(JSON.parse(h.stdout).authenticated, false);
});

test('parseArgs: --no-color works after the command', async () => {
  const h = harness();
  assert.equal(await h.run(['products', '--no-color']), 0);
  assert.match(h.stdout, /PRODUCT/);
});

test('status reports signed-out state without a token', async () => {
  const h = harness();
  assert.equal(await h.run(['status', '--json']), 0);
  const parsed = JSON.parse(h.stdout);
  assert.equal(parsed.authenticated, false);
  assert.equal(parsed.token, null);
});

test('cloud exits with the unavailable code and explains the roadmap', async () => {
  const h = harness();
  assert.equal(await h.run(['cloud']), 6);
  assert.match(h.stdout, /in development/i);
  assert.match(h.stdout, /Roadmap/);
  assert.match(h.stderr, /nothing/i);
});

test('projects exits with the unavailable code', async () => {
  const h = harness();
  assert.equal(await h.run(['projects', '--json']), 6);
  assert.equal(JSON.parse(h.stdout).unavailable, true);
});

test('config set and get round-trip through a 0600 file', async () => {
  const h = harness();
  assert.equal(await h.run(['config', 'set', 'base-url', 'https://example.test']), 0);
  assert.equal(await h.run(['config', 'get', 'base-url']), 0);
  assert.match(h.stdout, /https:\/\/example\.test/);

  const mode = fs.statSync(path.join(configDir, 'config.json')).mode & 0o777;
  assert.equal(mode.toString(8), '600');
});

test('config rejects an unknown key', async () => {
  const h = harness();
  assert.equal(await h.run(['config', 'set', 'nope', 'x']), 2);
  assert.match(h.stderr, /Unknown key/);
});

test('login verifies the token, then stores it with 0600 permissions', async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ email: 'dev@coderax.test' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  const h = harness({ fetchImpl });
  await h.run(['config', 'set', 'base-url', 'https://example.test']);
  assert.equal(await h.run(['login', '--token', 'secret-token-value-1234', '--json']), 0);

  const parsed = JSON.parse(h.stdout);
  assert.equal(parsed.authenticated, true);
  assert.equal(parsed.token, 'secr\u20261234');
  assert.equal(parsed.account, 'dev@coderax.test');

  const file = path.join(configDir, 'credentials.json');
  assert.equal((fs.statSync(file).mode & 0o777).toString(8), '600');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).token, 'secret-token-value-1234');
});

test('login refuses to store a rejected token', async () => {
  const fetchImpl = async () => new Response('{"message":"bad token"}', { status: 401 });
  const h = harness({ fetchImpl });
  await h.run(['config', 'set', 'base-url', 'https://example.test']);

  assert.equal(await h.run(['login', '--token', 'nope']), 3);
  assert.equal(fs.existsSync(path.join(configDir, 'credentials.json')), false);
});

test('logout removes stored credentials', async () => {
  const h = harness({
    fetchImpl: async () => new Response('{}', { status: 200 }),
  });
  await h.run(['config', 'set', 'base-url', 'https://example.test']);
  await h.run(['login', '--token', 'secret-token-value-1234']);
  assert.equal(await h.run(['logout', '--json']), 0);
  assert.equal(JSON.parse(h.stdout).removed, true);
  assert.equal(fs.existsSync(path.join(configDir, 'credentials.json')), false);
});

test('chat requires a base URL before it attempts a request', async () => {
  const h = harness();
  assert.equal(await h.run(['chat', 'hello']), 2);
  assert.match(h.stderr, /base URL/i);
});

test('chat requires authentication', async () => {
  const h = harness();
  await h.run(['config', 'set', 'base-url', 'https://example.test']);
  assert.equal(await h.run(['chat', 'hello']), 3);
});

test('chat streams deltas to stdout', async () => {
  const fetchImpl = async () =>
    sseResponse([
      'data: {"delta":"Hello"}\n\n',
      'data: {"delta":" world"}\n\n',
      'data: [DONE]\n\n',
    ]);

  const h = harness({ fetchImpl });
  await h.run(['config', 'set', 'base-url', 'https://example.test']);
  await h.run(['login', '--token', 'secret-token-value-1234']);

  assert.equal(await h.run(['chat', 'hi there']), 0);
  assert.match(h.stdout, /Hello world/);
});

test('Chat and Work preserve CRLF SSE deltas split across chunks', async () => {
  const fetchImpl = async () =>
    sseResponse([
      'data: {"delta":"Hel',
      'lo"}\r',
      '\n\r',
      '\n',
      'data: {"delta":" world"}\r\n\r\n',
      'data: [DONE]\r\n\r\n',
    ]);

  const h = harness({ fetchImpl });
  await h.run(['config', 'set', 'base-url', 'https://example.test']);
  seedCredentials();

  for (const mode of ['chat', 'work']) {
    assert.equal(await h.run([mode, 'hi', '--json']), 0);
    assert.deepEqual(JSON.parse(h.stdout), {
      mode,
      text: 'Hello world',
      events: 2,
    });
    assert.equal(h.stderr, '');
  }
});

test('chat emits JSON when asked', async () => {
  const fetchImpl = async () =>
    sseResponse(['data: {"delta":"alpha"}\n\n', 'data: {"delta":"beta"}\n\n']);
  const h = harness({ fetchImpl });
  await h.run(['config', 'set', 'base-url', 'https://example.test']);
  await h.run(['login', '--token', 'secret-token-value-1234']);

  assert.equal(await h.run(['chat', 'hi', '--json']), 0);
  assert.equal(JSON.parse(h.stdout).text, 'alphabeta');
});

test('chat surfaces an expired session as unauthenticated', async () => {
  const fetchImpl = async () => new Response('{"message":"expired"}', { status: 401 });
  const h = harness({ fetchImpl });
  await h.run(['config', 'set', 'base-url', 'https://example.test']);
  seedCredentials();

  assert.equal(await h.run(['chat', 'hi']), 3);
  assert.match(h.stderr, /Not authorised/);
});

test('chat maps a transport failure to the network code', async () => {
  const fetchImpl = async () => {
    throw new Error('ECONNREFUSED');
  };
  const h = harness({ fetchImpl });
  await h.run(['config', 'set', 'base-url', 'https://example.test']);
  seedCredentials();

  assert.equal(await h.run(['chat', 'hi']), 4);
  assert.match(h.stderr, /Cannot reach/);
});

test('cancelling a stream exits 130', async () => {
  const controller = new AbortController();
  // The login probe needs a normal response; only the chat call streams.
  const fetchImpl = async (url, init) => {
    if (String(url).includes('/api/user')) {
      return new Response(JSON.stringify({ email: 'dev@coderax.test' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(streamController) {
        streamController.enqueue(encoder.encode('data: {"delta":"partial"}\n\n'));
        init.signal.addEventListener('abort', () => {
          streamController.error(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      },
    });
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  };

  const h = harness({ fetchImpl, signal: controller.signal });
  await h.run(['config', 'set', 'base-url', 'https://example.test']);
  await h.run(['login', '--token', 'secret-token-value-1234']);

  setTimeout(() => controller.abort(), 20);
  assert.equal(await h.run(['chat', 'hi']), 130);
  assert.match(h.stderr, /Cancelled/i);
});

test('doctor flags a missing base URL', async () => {
  const h = harness();
  assert.equal(await h.run(['doctor', '--json']), 1);
  const parsed = JSON.parse(h.stdout);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.checks.find((check) => check.name === 'base-url').ok, false);
});

test('doctor passes once base URL, auth and health succeed', async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  const h = harness({ fetchImpl });
  await h.run(['config', 'set', 'base-url', 'https://example.test']);
  await h.run(['login', '--token', 'secret-token-value-1234']);

  assert.equal(await h.run(['doctor', '--json']), 0);
  assert.equal(JSON.parse(h.stdout).ok, true);
});

test('models and agents render server data', async () => {
  const fetchImpl = async (url) =>
    new Response(
      JSON.stringify(
        url.endsWith('/api/models')
          ? [{ id: 'gpt-5', provider: 'openai' }]
          : [{ id: 'agent-1', name: 'Reviewer', description: 'Reviews code' }],
      ),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );

  const h = harness({ fetchImpl });
  await h.run(['config', 'set', 'base-url', 'https://example.test']);
  await h.run(['login', '--token', 'secret-token-value-1234']);

  assert.equal(await h.run(['models', '--json']), 0);
  assert.equal(JSON.parse(h.stdout).models[0].id, 'gpt-5');

  assert.equal(await h.run(['agents', '--json']), 0);
  assert.equal(JSON.parse(h.stdout).agents[0].name, 'Reviewer');
});

test('update explains that the CLI is not published yet', async () => {
  const h = harness();
  assert.equal(await h.run(['update']), 0);
  assert.match(h.stdout, /not published/i);
});
