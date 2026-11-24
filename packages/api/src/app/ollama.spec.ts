import { once } from 'node:events';
import { connect, createServer } from 'node:net';
import { configSchema } from 'coderax-data-provider';
import type { AddressInfo, Server } from 'node:net';
import { registerShutdownTask } from './shutdown';
import { startOllamaLoopback } from './ollama';

jest.mock('./shutdown', () => ({ registerShutdownTask: jest.fn() }));

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function listen(server: Server): Promise<number> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return (server.address() as AddressInfo).port;
}

afterEach(async () => {
  for (const [, cleanup] of jest.mocked(registerShutdownTask).mock.calls) {
    await cleanup();
  }
  jest.clearAllMocks();
});

test('validates deployment settings and keeps the Compose defaults', () => {
  expect(configSchema.parse({ version: '1' }).ollamaLoopback).toBeUndefined();
  expect(
    configSchema.parse({ version: '1', ollamaLoopback: { enabled: true } }).ollamaLoopback,
  ).toEqual({
    enabled: true,
    listenHost: '127.0.0.1',
    listenPort: 11434,
    upstreamHost: 'ollama',
    upstreamPort: 11434,
    connectTimeoutMs: 10000,
  });
  for (const options of [
    { listenHost: '0.0.0.0' },
    { listenHost: '127.0.999.1' },
    { upstreamPort: 65536 },
    { connectTimeoutMs: 0 },
  ]) {
    expect(configSchema.safeParse({ version: '1', ollamaLoopback: options }).success).toBe(false);
  }
});

test('forwards a reply after client EOF using the YAML settings over legacy environment', async () => {
  const upstream = createServer({ allowHalfOpen: true }, (socket) => {
    socket.setEncoding('utf8');
    let request = '';
    socket.on('data', (chunk: string) => (request += chunk));
    socket.on('end', () => socket.end(`reply: ${request}`));
  });
  const upstreamPort = await listen(upstream);
  const reservation = createServer();
  const listenPort = await listen(reservation);
  await close(reservation);
  const onFatal = jest.fn();
  try {
    await startOllamaLoopback(
      {
        enabled: true,
        listenHost: 'localhost',
        listenPort,
        upstreamHost: '127.0.0.1',
        upstreamPort,
        connectTimeoutMs: 2000,
      },
      { OLLAMA_LOOPBACK_HOST: '0.0.0.0', OLLAMA_UPSTREAM_PORT: 'invalid' },
      onFatal,
    );
    const client = connect(listenPort, '127.0.0.1');
    try {
      client.setEncoding('utf8');
      let reply = '';
      client.on('data', (chunk: string) => (reply += chunk));
      const ended = once(client, 'end');
      client.end('request');
      await ended;
      expect(reply).toBe('reply: request');
      expect(onFatal).not.toHaveBeenCalled();
    } finally {
      client.destroy();
    }
  } finally {
    await close(upstream);
  }
});

test('does not bind without opt-in and rejects startup when the port is occupied', async () => {
  const occupied = createServer();
  const listenPort = await listen(occupied);
  try {
    await expect(startOllamaLoopback({ listenPort }, {}, jest.fn())).resolves.toBeUndefined();
    await expect(
      startOllamaLoopback(
        { enabled: true },
        { OLLAMA_LOOPBACK_PORT: String(listenPort) },
        jest.fn(),
      ),
    ).rejects.toMatchObject({ code: 'EADDRINUSE' });
    expect(registerShutdownTask).not.toHaveBeenCalled();
  } finally {
    await close(occupied);
  }
});
