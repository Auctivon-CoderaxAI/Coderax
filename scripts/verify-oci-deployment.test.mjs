import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { test } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFile(path.join(root, relative), 'utf8');
const readIfPresent = (relative) =>
  read(relative).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });

function serviceBlock(source, name) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${name}:`);
  assert.notEqual(start, -1, `missing Compose service ${name}`);
  const end = lines.findIndex((line, index) => index > start && /^ {2}[a-zA-Z0-9_-]+:$/.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

test('OCI Compose publishes only Caddy and keeps model/app ports private', async () => {
  const compose = await read('deploy/oci/compose.yaml');
  const web = serviceBlock(compose, 'web');
  const app = serviceBlock(compose, 'app');
  const ollama = serviceBlock(compose, 'ollama');
  const modelSetup = serviceBlock(compose, 'model-setup');

  assert.match(web, /"80:80"/);
  assert.match(web, /"443:443"/);
  assert.doesNotMatch(app, /^\s+ports:/m);
  assert.doesNotMatch(ollama, /^\s+ports:/m);
  assert.match(ollama, /networks:\s+- model\s*$/m);
  assert.match(modelSetup, /networks:\s+- internet\s*$/m);
  assert.match(modelSetup, /ollama pull qwen3\.5:4b/);
  assert.match(modelSetup, /ollama pull qwen3\.5:9b/);
  assert.match(compose, /model:\s+internal:\s+true/);
  assert.doesNotMatch(compose, /^\s+mongodb:/m);
  assert.doesNotMatch(compose, /27017:|11434:|7700:/);
});

test('Caddy requires the private proxy header and preserves origin and streaming metadata', async () => {
  const caddy = (await read('deploy/oci/Caddyfile')).replace(/\r\n/g, '\n');
  assert.match(
    caddy,
    /@unauthorized \{[\s\S]*?not header X-Coderax-Proxy-Secret \{\$CODERAX_PROXY_SECRET\}[\s\S]*?not path \/api\/work\/chat\n[\s\S]*?not path \/api\/work\/chat\/\*/,
  );
  assert.match(
    caddy,
    /@direct_work \{[\s\S]*?path \/api\/work\/chat\n[\s\S]*?path \/api\/work\/chat\/\*[\s\S]*?path \/api\/agents\/chat\/stream\n[\s\S]*?path \/api\/agents\/chat\/stream\/\*[\s\S]*?not header X-Coderax-Proxy-Secret/,
  );
  assert.match(caddy, /header_up Host coderaxai\.vercel\.app/);
  assert.match(caddy, /header_up -X-Coderax-Proxy-Secret/);
  assert.match(caddy, /header_up Host \{http\.request\.header\.X-Forwarded-Host\}/);
  assert.match(caddy, /header_up X-Forwarded-Proto https/);
  assert.match(caddy, /header_up X-Forwarded-For \{http\.request\.header\.X-Forwarded-For\}/);
  assert.match(caddy, /flush_interval -1/);
});

test('Vercel uses the authenticated proxy for every API and health rewrite', async () => {
  const vercel = JSON.parse(await read('vercel.json'));
  assert.equal(vercel.services.backend.entrypoint, 'api/proxy.js');
  assert.match(
    vercel.services.backend.functions['api/proxy.js'].includeFiles,
    /packages\/api\/dist\/proxy\.cjs/,
  );
  assert.equal(vercel.services.backend.functions['api/proxy.js'].maxDuration, 300);
  for (const route of ['/api/(.*)', '/oauth/(.*)', '/readyz']) {
    assert.equal(
      vercel.rewrites.find((item) => item.source === route)?.destination?.service,
      'backend',
    );
  }
});

test('OCI keeps Ollama private and opts native Work into free inference', async () => {
  const config = await read('deploy/oci/coderax.oci.yaml');
  const compose = await read('deploy/oci/compose.yaml');
  const app = serviceBlock(compose, 'app');
  assert.match(config, /^freeInference:\r?\n {2}enabled: true\r?$/m);
  assert.doesNotMatch(config, /^\s*(?:OPENROUTER_API_KEY|name: FreeOpenRouter)/m);
  assert.match(app, /env_file:\s+- \.\/app\.env/);
  assert.match(app, /CONFIG_PATH: \/app\/deploy\/oci\/coderax\.yaml/);
  assert.match(config, /baseURL: http:\/\/ollama:11434\/v1\//);
  assert.match(config, /qwen3\.5:9b[\s\S]*qwen3\.5:4b/);
  assert.match(app, /\.\/coderax\.oci\.yaml:\/app\/deploy\/oci\/coderax\.yaml:ro/);
  assert.match(compose, /OLLAMA_NO_CLOUD: "1"/);
  assert.match(compose, /OLLAMA_KEEP_ALIVE: "-1"/);
  assert.match(compose, /ALLOW_REGISTRATION: "false"/);
  assert.match(compose, /ENABLE_GUEST_ACCESS: "true"/);
  assert.match(compose, /REGISTER_WINDOW: "60"/);
  assert.match(compose, /REGISTER_MAX: "5"/);
});

test('production image starts Node without depending on pruned dev tools', async () => {
  const dockerfile = await read('Dockerfile');
  assert.match(dockerfile, /^ENV NODE_ENV=production$/m);
  assert.match(dockerfile, /^CMD \["node", "api\/server\/index\.js"\]$/m);
  assert.doesNotMatch(dockerfile, /^CMD \["npm", "run", "backend"\]$/m);
});

test('environment setup writes only protected, untracked secret files', async () => {
  const setup = await read('deploy/oci/prepare-env.sh');
  const ignore = await readIfPresent('.gitignore');
  const dockerIgnore = await readIfPresent('.dockerignore');
  assert.match(setup, /umask 077/);
  assert.match(setup, /Refusing to replace existing app\.env or origin\.env/);
  assert.match(setup, /read_secret JWT_SECRET/);
  assert.match(setup, /read_secret CREDS_KEY/);
  assert.doesNotMatch(setup, /CREDS_KEY=\$\(openssl rand/);
  assert.match(setup, /openssl rand -hex 32/);
  assert.match(setup, /chmod 600 app\.env origin\.env/);
  assert.match(setup, /do not print or commit that file/);
  if (ignore) assert.match(ignore, /deploy\/oci\/\*\.env/);
  if (dockerIgnore) assert.match(dockerIgnore, /deploy\/oci\/\*\.env/);
});
