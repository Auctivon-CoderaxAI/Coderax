#!/usr/bin/env node
'use strict';

// The pinned Freebuff SDK accepts a plain-HTTP provider endpoint only on
// loopback, so a Compose service name such as `http://ollama:11434/v1` is
// rejected before a request is sent. This forwarder listens on loopback inside
// the API container and tunnels to the `ollama` service, keeping the endpoint
// the SDK sees on 127.0.0.1 while the model server stays off the default
// network.

const net = require('node:net');

function parsePort(name) {
  const value = process.env[name] ?? '11434';
  const port = Number(value);
  if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`[ollama-loopback] ${name} must be an integer from 1 to 65535`);
    process.exit(1);
  }
  return port;
}

const configuredHost = process.env.OLLAMA_LOOPBACK_HOST || '127.0.0.1';
const listenHost = configuredHost.toLowerCase() === 'localhost' ? '127.0.0.1' : configuredHost;
if (listenHost !== '::1' && !(net.isIPv4(listenHost) && listenHost.startsWith('127.'))) {
  console.error('[ollama-loopback] OLLAMA_LOOPBACK_HOST must be a loopback address');
  process.exit(1);
}

const listenPort = parsePort('OLLAMA_LOOPBACK_PORT');
const upstreamHost = process.env.OLLAMA_UPSTREAM_HOST || 'ollama';
const upstreamPort = parsePort('OLLAMA_UPSTREAM_PORT');
const withApi = process.argv.includes('--with-api');
// Bound DNS and TCP connect time; streaming replies have no idle deadline here.
const connectTimeoutMs = 10_000;

let lastUpstreamErrorAt = 0;

function logUpstreamError(err) {
  const now = Date.now();
  if (now - lastUpstreamErrorAt < 5000) {
    return;
  }
  lastUpstreamErrorAt = now;
  console.error(
    `[ollama-loopback] upstream ${upstreamHost}:${upstreamPort} failed: ${err.message}`,
  );
}

const server = net.createServer({ allowHalfOpen: true }, (client) => {
  const upstream = net.connect({ host: upstreamHost, port: upstreamPort, allowHalfOpen: true });
  const connectTimer = setTimeout(() => {
    upstream.destroy(new Error('connection timed out'));
  }, connectTimeoutMs);

  client.on('error', () => upstream.destroy());
  upstream.on('error', (err) => {
    logUpstreamError(err);
    client.destroy();
  });
  upstream.once('connect', () => clearTimeout(connectTimer));
  upstream.once('close', () => clearTimeout(connectTimer));

  // pipe propagates EOF independently in each direction. Only an incomplete
  // close should destroy the peer; it may still be flushing a normal reply.
  client.once('close', () => {
    if (!client.readableEnded || !client.writableFinished) {
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

server.on('error', (err) => {
  console.error(`[ollama-loopback] listen ${listenHost}:${listenPort} failed: ${err.message}`);
  process.exit(1);
});

server.on('close', () => {
  console.error('[ollama-loopback] listener closed');
  process.exit(1);
});

server.listen(listenPort, listenHost, () => {
  console.log(`[ollama-loopback] ${listenHost}:${listenPort} -> ${upstreamHost}:${upstreamPort}`);
  if (withApi) {
    require('../api/server/index.js');
  }
});
