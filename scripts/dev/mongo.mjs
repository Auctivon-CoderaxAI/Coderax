/**
 * Local MongoDB for development.
 *
 * Runs a standalone `mongod` (downloaded on first use by mongodb-memory-server)
 * on 127.0.0.1:27017 with its data directory inside the repository, so users,
 * conversations and config survive restarts.
 *
 *   npm run dev:mongo   start; Ctrl+C stops it
 *   npm run dev:up      start it as part of the whole stack
 *
 * CODERAX_MONGO_PORT overrides the port (default 27017); the data directory is
 * always .dev/mongo/data. Inside the stack, `npm run dev:down` stops it.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MongoMemoryServer } from 'mongodb-memory-server';

const host = '127.0.0.1';
const port = Number(process.env.CODERAX_MONGO_PORT ?? 27017);
const dbPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.dev/mongo/data');

function fail(message) {
  console.error(`[mongo] ${message}`);
  process.exit(1);
}

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  fail(`invalid CODERAX_MONGO_PORT: ${process.env.CODERAX_MONGO_PORT}`);
}

/** An occupied port otherwise surfaces as an opaque mongod stack trace. */
const portInUse = await new Promise((resolve) => {
  const socket = net.connect({ host, port });
  socket.once('connect', () => {
    socket.destroy();
    resolve(true);
  });
  socket.once('error', () => {
    socket.destroy();
    resolve(false);
  });
});
if (portInUse) {
  fail(
    `port ${host}:${port} is already in use; stop it (\`npm run dev:down\`) or set CODERAX_MONGO_PORT`,
  );
}

fs.mkdirSync(dbPath, { recursive: true });

let mongo;
try {
  mongo = await MongoMemoryServer.create({
    instance: { dbPath, ip: host, port, storageEngine: 'wiredTiger' },
  });
} catch (error) {
  fail(`could not start mongod: ${error instanceof Error ? error.message : String(error)}`);
}

console.log(`[mongo] listening on ${host}:${port} (pid ${process.pid})`);
console.log(`[mongo] data directory: ${dbPath}`);
console.log(`[mongo] MONGO_URI=mongodb://${host}:${port}/Coderax`);

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, async () => {
    if (stopping) {
      return;
    }
    stopping = true;
    console.log(`[mongo] ${signal} received, stopping`);
    try {
      await mongo.stop({ doCleanup: false });
      process.exit(0);
    } catch (error) {
      console.error(
        `[mongo] failed to stop cleanly: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(1);
    }
  });
}
