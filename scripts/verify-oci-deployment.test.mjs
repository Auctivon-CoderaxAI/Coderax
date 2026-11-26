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

test('OCI Compose publishes only Caddy and starts no local model server', async () => {
  const compose = await read('deploy/oci/compose.yaml');
  const web = serviceBlock(compose, 'web');
  const app = serviceBlock(compose, 'app');
  const opencode = serviceBlock(compose, 'opencode');

  assert.match(web, /"80:80"/);
  assert.match(web, /"443:443"/);
  assert.match(web, /env_file:\s*\n\s*- \.\/origin\.env/);
  assert.doesNotMatch(web, /CODERAX_PUBLIC_HOST:/);
  assert.doesNotMatch(app, /^\s+ports:/m);
  assert.doesNotMatch(compose, /^  ollama:/m);
  assert.doesNotMatch(compose, /^  model-setup:/m);
  assert.doesNotMatch(compose, /11434|qwen3\.5/);
  assert.doesNotMatch(compose, /model:\s+internal:\s+true/);
  assert.doesNotMatch(compose, /^\s+mongodb:/m);
  assert.doesNotMatch(compose, /4096:|27017:|7700:/);

  assert.match(opencode, /env_file:\s*\n\s*- \.\/engine\.env/);
  assert.match(opencode, /read_only: true/);
  assert.match(opencode, /no-new-privileges:true/);
  assert.match(opencode, /cap_drop:\s*\n\s*- ALL/);
  assert.match(opencode, /engine-workspace:\/srv\/engine/);
  assert.match(opencode, /engine-data:\/data/);
  assert.doesNotMatch(opencode, /engine-private/);
  assert.doesNotMatch(opencode, /^\s+ports:/m);
  assert.match(app, /engine-workspace:\/srv\/engine/);
  assert.match(app, /engine-private:\/srv\/coderax\/private/);
  assert.doesNotMatch(web, /^\s+- engine$/m);
  assert.match(compose, /^  engine: \{\}$/m);
  assert.match(compose, /^  engine-workspace: \{\}$/m);
  assert.match(compose, /^  engine-private: \{\}$/m);
  assert.match(compose, /^  engine-data: \{\}$/m);
});

test('OpenCode runtime is authenticated, private and readiness-probed', async () => {
  const entrypoint = await read('deploy/oci/opencode/entrypoint.sh');
  const healthcheck = await read('deploy/oci/opencode/healthcheck.sh');
  const dockerfile = await read('deploy/oci/opencode/Dockerfile');
  const config = await read('deploy/oci/coderax.oci.yaml');

  assert.match(entrypoint, /OPENCODE_SERVER_PASSWORD is required/);
  assert.match(entrypoint, /exec opencode serve/);
  assert.match(healthcheck, /\/global\/health/);
  assert.match(healthcheck, /curl[\s\S]*-u "\$\{user\}:\$\{OPENCODE_SERVER_PASSWORD:-\}"/);
  assert.match(dockerfile, /opencode-ai@\$\{OPENCODE_VERSION\}/);
  assert.match(dockerfile, /^USER node$/m);
  assert.match(dockerfile, /^EXPOSE 4096$/m);
  assert.match(config, /baseURL: http:\/\/opencode:4096/);
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
  assert.match(
    caddy,
    /header_up Host \{\$CODERAX_PUBLIC_HOST:coderax\.nnabdelshahid\.workers\.dev\}/,
  );
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

test('OCI keeps native Work on free hosted models without embedding a key', async () => {
  const config = await read('deploy/oci/coderax.oci.yaml');
  const compose = await read('deploy/oci/compose.yaml');
  const app = serviceBlock(compose, 'app');
  assert.match(config, /^freeInference:\r?\n {2}enabled: true\r?$/m);
  assert.doesNotMatch(config, /^\s*(?:OPENROUTER_API_KEY|name: FreeOpenRouter)/m);
  assert.doesNotMatch(config, /ollama|11434|qwen3\.5/i);
  assert.match(app, /env_file:\s+- \.\/app\.env/);
  assert.match(app, /CONFIG_PATH: \/app\/deploy\/oci\/coderax\.yaml/);
  assert.match(app, /\.\/coderax\.oci\.yaml:\/app\/deploy\/oci\/coderax\.yaml:ro/);
  assert.match(compose, /ALLOW_REGISTRATION: "false"/);
  assert.match(compose, /ENABLE_GUEST_ACCESS: "false"/);
  assert.match(compose, /CODERAX_PUBLIC_ORIGIN:-https:\/\/coderax\.nnabdelshahid\.workers\.dev/);
  assert.match(compose, /REGISTER_WINDOW: "60"/);
  assert.match(compose, /REGISTER_MAX: "5"/);
});

test('OCI documentation names the config its compose file mounts', async () => {
  const readme = await read('deploy/oci/README.md');
  assert.match(readme, /deploy\/oci\/coderax\.oci\.yaml/);
  assert.doesNotMatch(readme, /deploy\/cloud\/coderax\.yaml/);
});

test('cloud Work offers hosted free models without embedding a key', async () => {
  const config = await read('deploy/cloud/coderax.yaml');
  const compose = await read('deploy/cloud/compose.yaml');
  assert.match(config, /^freeInference:\r?\n {2}enabled: true\r?$/m);
  assert.doesNotMatch(config, /^\s*(?:OPENROUTER_API_KEY|name: FreeOpenRouter)/m);
  assert.doesNotMatch(config, /ollama|11434|qwen3\.5/i);
  assert.match(compose, /env_file:\s+- \.\.\/\.\.\/\.env/);
  assert.doesNotMatch(compose, /ollama|qwen3\.5/i);
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
  assert.match(setup, /read_secret PASSWORD_LOGIN_PASSWORD/);
  assert.match(setup, /PASSWORD_LOGIN_PASSWORD is required/);
  assert.match(setup, /PASSWORD_LOGIN_PASSWORD must not contain a single quote or backslash/);
  assert.match(setup, /PASSWORD_LOGIN_PASSWORD='\$PASSWORD_LOGIN_PASSWORD'/);
  assert.match(setup, /unset MONGO_URI[\s\S]*?PASSWORD_LOGIN_PASSWORD/);
  assert.match(setup, /read_secret OPENROUTER_API_KEY/);
  assert.match(setup, /An OpenRouter API key is required/);
  assert.doesNotMatch(setup, /optional, press Enter to skip/);
  assert.match(setup, /OPENROUTER_API_KEY=%s\\n' "\$OPENROUTER_API_KEY" >> app\.env/);
  assert.doesNotMatch(setup, /CREDS_KEY=\$\(openssl rand/);
  assert.match(setup, /openssl rand -hex 32/);
  assert.match(setup, /CODERAX_PUBLIC_HOST=coderax\.nnabdelshahid\.workers\.dev/);
  assert.match(setup, /chmod 600 app\.env origin\.env engine\.env/);
  assert.match(setup, /do not print or commit that file/);
  if (ignore) assert.match(ignore, /deploy\/oci\/\*\.env/);
  if (dockerIgnore) assert.match(dockerIgnore, /deploy\/oci\/\*\.env/);
});
