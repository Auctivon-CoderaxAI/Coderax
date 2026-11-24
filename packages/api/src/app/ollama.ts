import { logger } from '@coderax/data-schemas';
import { createServer, connect } from 'node:net';
import { ollamaLoopbackConfigSchema } from 'coderax-data-provider';
import type { TCustomConfig } from 'coderax-data-provider';
import type { Socket } from 'node:net';
import { registerShutdownTask } from './shutdown';

function legacyPort(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return /^\d+$/.test(value) ? Number(value) : NaN;
}

/** Start the deployment listener before the API begins serving. */
export async function startOllamaLoopback(
  config: TCustomConfig['ollamaLoopback'],
  env: NodeJS.ProcessEnv,
  onFatal: (error: Error) => void,
): Promise<void> {
  if (config?.enabled !== true) {
    return;
  }

  // The existing config loader returns raw YAML. Apply defaults and normalize
  // legacy environment values through the same schema before opening sockets.
  const { listenHost, listenPort, upstreamHost, upstreamPort, connectTimeoutMs } =
    ollamaLoopbackConfigSchema.parse({
      ...config,
      listenHost: config.listenHost ?? (env.OLLAMA_LOOPBACK_HOST || undefined),
      listenPort: config.listenPort ?? legacyPort(env.OLLAMA_LOOPBACK_PORT),
      upstreamHost: config.upstreamHost ?? (env.OLLAMA_UPSTREAM_HOST || undefined),
      upstreamPort: config.upstreamPort ?? legacyPort(env.OLLAMA_UPSTREAM_PORT),
    });

  let lastUpstreamErrorAt = 0;
  let closing = false;
  const clients = new Set<Socket>();
  const server = createServer({ allowHalfOpen: true }, (client) => {
    clients.add(client);
    const upstream = connect({ host: upstreamHost, port: upstreamPort, allowHalfOpen: true });
    // Bound DNS and TCP connect time; leave established streams alone.
    const timer = setTimeout(
      () =>
        upstream.destroy(Object.assign(new Error('Connection timed out'), { code: 'ETIMEDOUT' })),
      connectTimeoutMs,
    );

    client.on('error', () => upstream.destroy());
    upstream.on('error', (error: NodeJS.ErrnoException) => {
      const now = Date.now();
      if (now - lastUpstreamErrorAt >= 5_000) {
        lastUpstreamErrorAt = now;
        logger.warn('[ollama-loopback] upstream connection failed', { code: error.code });
      }
      client.destroy();
    });
    upstream.once('connect', () => clearTimeout(timer));
    upstream.once('close', () => clearTimeout(timer));

    // Each pipe propagates EOF independently. An incomplete close is the only
    // reason to interrupt a peer that might still be flushing a normal reply.
    client.once('close', () => {
      clients.delete(client);
      if (closing || !client.readableEnded || !client.writableFinished) {
        upstream.destroy();
      }
    });
    upstream.once('close', () => {
      if (!upstream.readableEnded || !upstream.writableFinished) {
        client.destroy();
      }
    });

    client.pipe(upstream);
    upstream.pipe(client);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(listenPort, listenHost, () => {
      server.off('error', reject);
      server.on('error', onFatal);
      resolve();
    });
  });
  server.on('close', () => {
    if (!closing) {
      onFatal(new Error('Ollama loopback listener closed unexpectedly'));
    }
  });

  registerShutdownTask('Ollama loopback listener', async () => {
    closing = true;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      for (const client of clients) {
        client.destroy();
      }
    });
  });
}
