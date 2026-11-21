import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { DEV_DIR } from './lib.mjs';

const port = Number(process.env.DEV_MONGO_PORT || 27017);
const dbPath = path.join(DEV_DIR, 'mongo');
mkdirSync(dbPath, { recursive: true });

// Keep the downloaded mongod binary beside the data so an archived workspace
// does not have to fetch it again.
process.env.MONGOMS_DOWNLOAD_DIR ??= path.join(DEV_DIR, 'cache', 'mongodb-binaries');

let MongoMemoryServer;
try {
  ({ MongoMemoryServer } = await import('mongodb-memory-server'));
} catch {
  console.error(
    '[dev:mongo] mongodb-memory-server is not installed. Run `npm ci` from the repository root.',
  );
  process.exit(1);
}

const server = await MongoMemoryServer.create({
  instance: {
    port,
    dbPath,
    storageEngine: 'wiredTiger',
    ip: '127.0.0.1',
  },
});

console.log(`[dev:mongo] listening at mongodb://127.0.0.1:${port} (data: ${dbPath})`);

const shutdown = async () => {
  await server.stop({ doCleanup: false }).catch(() => {});
  process.exit(0);
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);

// Hold the process open; mongod is a child of this script.
setInterval(() => {}, 1 << 30);
