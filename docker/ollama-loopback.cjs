#!/usr/bin/env node
'use strict';

// The pinned Freebuff SDK accepts a plain-HTTP provider endpoint only on
// loopback, so a Compose service name such as `http://ollama:11434/v1` is
// rejected before a request is sent. This forwarder listens on loopback inside
// the API container and tunnels to the `ollama` service, keeping the endpoint
// the SDK sees on 127.0.0.1 while the model server stays off the default
// network.

const net = require('node:net');

const listenHost = process.env.OLLAMA_LOOPBACK_HOST || '127.0.0.1';
const listenPort = Number(process.env.OLLAMA_LOOPBACK_PORT || 11434);
const upstreamHost = process.env.OLLAMA_UPSTREAM_HOST || 'ollama';
const upstreamPort = Number(process.env.OLLAMA_UPSTREAM_PORT || 11434);

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

const server = net.createServer((client) => {
  const upstream = net.connect({ host: upstreamHost, port: upstreamPort });

  client.on('error', () => client.destroy());
  upstream.on('error', (err) => {
    logUpstreamError(err);
    client.destroy();
  });
  upstream.on('close', () => client.destroy());
  client.on('close', () => upstream.destroy());

  client.pipe(upstream).pipe(client);
});

server.on('error', (err) => {
  console.error(
    `[ollama-loopback] listen ${listenHost}:${listenPort} failed: ${err.message}`,
  );
  process.exit(1);
});

server.listen(listenPort, listenHost, () => {
  console.log(
    `[ollama-loopback] ${listenHost}:${listenPort} -> ${upstreamHost}:${upstreamPort}`,
  );
});
