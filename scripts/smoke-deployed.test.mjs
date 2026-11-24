import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test } from 'node:test';

async function runSmoke(baseUrl) {
  const child = spawn(
    process.execPath,
    [new URL('./smoke-deployed.mjs', import.meta.url).pathname],
    {
      env: {
        CODERAX_BASE_URL: baseUrl,
        CODERAX_SMOKE_EMAIL: 'fixture@example.test',
        CODERAX_SMOKE_PASSWORD: 'fixture-password',
        CODERAX_SMOKE_MODEL: 'model-fixture',
      },
    },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
  const [code] = await once(child, 'close');
  return { code, stdout, stderr };
}

test('rejects a remote HTTP origin before making credential-bearing requests', async () => {
  const result = await runSmoke('http://example.invalid');
  assert.equal(result.code, 2);
  assert.match(result.stderr, /must use HTTPS/);
});

test('uses the password-login token and accepts all supported catalog forms', async () => {
  const catalogs = [
    { openAI: ['model-fixture'] },
    { models: [{ id: 'model-fixture' }] },
    [{ name: 'model-fixture' }],
    { openAI: [''], metadata: { model: 'model-fixture' } },
  ];
  let catalog = catalogs[0];
  const seen = [];
  const server = createServer((req, res) => {
    const bearer = req.headers.authorization;
    seen.push([req.url, bearer]);
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/auth/login' && !bearer) {
      res.end(JSON.stringify({ token: 'fixture-session' }));
    } else if (['/health', '/api/config'].includes(req.url) && !bearer) {
      res.end('{}');
    } else if (req.url === '/api/user' || req.url === '/api/models') {
      const allowed = bearer === 'Bearer fixture-session';
      res.statusCode = allowed ? 200 : 401;
      res.end(
        JSON.stringify(allowed ? (req.url === '/api/models' ? catalog : { id: 'fixture' }) : {}),
      );
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    for (const [index, value] of catalogs.entries()) {
      catalog = value;
      const result = await runSmoke(`http://127.0.0.1:${server.address().port}`);
      const report = JSON.parse(result.stdout);
      if (index < 3) {
        assert.equal(result.code, 0, result.stdout);
      } else {
        assert.equal(result.code, 1, result.stdout);
        assert.match(
          report.checks.find(({ name }) => name === 'models catalog').detail,
          /catalog is empty/,
        );
      }
    }
    assert.deepEqual(
      seen.filter(([url]) => url === '/api/auth/login'),
      Array(4).fill(['/api/auth/login', undefined]),
    );
    assert.deepEqual(
      seen.filter(([url]) => url === '/api/models'),
      Array(4).fill(['/api/models', 'Bearer fixture-session']),
    );
  } finally {
    server.close();
    await once(server, 'close');
  }
});
