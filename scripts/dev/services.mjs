import path from 'node:path';
import { ROOT, httpOk, npmCommand, tcpOpen } from './lib.mjs';

const LOOPBACK = '127.0.0.1';

export function ports(env) {
  const mongoPort = Number(
    env.DEV_MONGO_PORT ||
      new URL(env.MONGO_URI ?? 'mongodb://127.0.0.1:27017/Coderax').port ||
      27017,
  );
  return {
    mongo: mongoPort,
    model: Number(env.DEV_MODEL_PORT || 8080),
    api: Number(env.PORT || 3080),
    vite: Number(env.DEV_VITE_PORT || 3090),
  };
}

/** `dev` runs Vite with HMR; `preview` serves the built client with `vite preview`. */
function clientMode(env) {
  return env.DEV_CLIENT_MODE === 'preview' ? 'preview' : 'dev';
}

/**
 * `dev:up` starts its own mongod on DEV_MONGO_PORT while the API connects to
 * MONGO_URI, so the two must name the same port or the API reaches nothing.
 */
export function assertMongoEndpoint(env) {
  const uriPort = new URL(env.MONGO_URI ?? 'mongodb://127.0.0.1:27017/Coderax').port || '27017';
  if (env.DEV_MONGO_PORT && String(env.DEV_MONGO_PORT) !== uriPort) {
    throw new Error(
      `DEV_MONGO_PORT=${env.DEV_MONGO_PORT} but MONGO_URI uses port ${uriPort}; ` +
        'the API would not reach the supervised mongod. Make both ports match in .env.',
    );
  }
}

export function createServices(env) {
  const port = ports(env);
  const modelId = env.DEV_MODEL_ID || 'qwen2.5-1.5b-instruct';
  const preview = clientMode(env) === 'preview';
  const clientOrigin = `http://${LOOPBACK}:${port.vite}`;
  /* Loopback by default: the Vite proxy forwards to the API, so binding it to
     every interface would publish that API to the network. */
  const viteHost = env.DEV_VITE_HOST || LOOPBACK;
  const apiHost = env.DEV_API_HOST || LOOPBACK;

  return [
    {
      name: 'mongo',
      port: port.mongo,
      timeoutMs: 300_000,
      command: process.execPath,
      args: [path.join('scripts', 'dev', 'mongo.mjs')],
      cwd: ROOT,
      env: { ...env, DEV_MONGO_PORT: String(port.mongo) },
      detail: `mongodb://${LOOPBACK}:${port.mongo}`,
      ready: () => tcpOpen(port.mongo),
    },
    {
      name: 'model',
      port: port.model,
      timeoutMs: 180_000,
      command: 'bash',
      args: [path.join('scripts', 'dev', 'model.sh')],
      cwd: ROOT,
      env: { ...env, DEV_MODEL_PORT: String(port.model), DEV_MODEL_ID: modelId },
      detail: `llama-server ${modelId} on ${LOOPBACK}:${port.model}`,
      ready: () => httpOk(`http://${LOOPBACK}:${port.model}/health`),
    },
    {
      name: 'api',
      port: port.api,
      timeoutMs: 180_000,
      command: process.execPath,
      args: [path.join('api', 'server', 'index.js')],
      cwd: ROOT,
      // The client service owns the shell, so the API boots without client/dist.
      env: {
        ...env,
        HOST: apiHost,
        PORT: String(port.api),
        NODE_ENV: 'development',
        SERVE_CLIENT: 'false',
      },
      detail: `http://${LOOPBACK}:${port.api}`,
      ready: () => httpOk(`http://${LOOPBACK}:${port.api}/readyz`),
    },
    {
      name: 'vite',
      port: port.vite,
      timeoutMs: 180_000,
      command: npmCommand(),
      args: preview
        ? [
            'run',
            'preview-prod',
            '--',
            '--host',
            viteHost,
            '--port',
            String(port.vite),
            '--strictPort',
          ]
        : ['run', 'dev'],
      cwd: path.join(ROOT, 'client'),
      env: {
        ...env,
        NODE_ENV: 'development',
        // HOST is where Vite listens; BACKEND_HOST is where its proxy sends /api,
        // which stays the API's own address even when Vite binds a LAN interface.
        HOST: viteHost,
        PORT: String(port.vite),
        BACKEND_HOST: apiHost,
        BACKEND_PORT: String(port.api),
      },
      detail: `${clientOrigin} ${preview ? 'built client' : 'vite dev'} -> ${LOOPBACK}:${port.api}`,
      // The preview is only useful if its proxy reaches the API as well.
      ready: preview
        ? async () =>
            (await httpOk(`${clientOrigin}/`, 4000)) &&
            (await httpOk(`${clientOrigin}/api/config`, 4000))
        : () => httpOk(`${clientOrigin}/`, 4000),
    },
  ];
}
