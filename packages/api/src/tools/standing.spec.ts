import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createMethods, createModels } from '@coderax/data-schemas';
import type {
  ToolStandingAuthorization,
  ToolStandingAuthorizationStorage,
} from 'coderax-data-provider';
import { authorizeStandingWork } from './standing';

const scope = { userId: new mongoose.Types.ObjectId().toString() };

let mongoServer: MongoMemoryServer;
let storage: ToolStandingAuthorizationStorage;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  storage = createMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.models.ToolStandingAuthorization.deleteMany({});
});

/** The normal path runs through the real storage methods, not a double. */
const createGrant = async (): Promise<string> => {
  const created = await storage.createToolStandingAuthorization(scope, {
    label: 'Zero-cost reads',
    tools: ['read_*'],
  });
  if (!created.ok) {
    throw new Error(`grant rejected: ${created.error.code}`);
  }
  return created.value.id;
};

describe('authorizeStandingWork', () => {
  test('denies when no store or scope is injected', async () => {
    await expect(authorizeStandingWork({ toolName: 'read_file' }, {})).resolves.toEqual({
      allowed: false,
      reason: 'unavailable',
    });
    await expect(
      authorizeStandingWork(
        { toolName: 'read_file' },
        { storage: { listToolStandingAuthorizations: jest.fn() } },
      ),
    ).resolves.toEqual({ allowed: false, reason: 'unavailable' });
  });

  test('allows a call covered by a stored authorization', async () => {
    const id = await createGrant();
    await expect(
      authorizeStandingWork({ toolName: 'read_file', projectId: 'proj-1' }, { storage, scope }),
    ).resolves.toEqual({ allowed: true, authorizationId: id });
  });

  test('denies when the store rejects instead of approving by default', async () => {
    const storage = {
      listToolStandingAuthorizations: jest.fn().mockRejectedValue(new Error('db down')),
    };
    await expect(
      authorizeStandingWork({ toolName: 'read_file' }, { storage, scope }),
    ).resolves.toEqual({ allowed: false, reason: 'unavailable' });
  });

  test('denies when the lookup outlives its budget', async () => {
    const storage = {
      listToolStandingAuthorizations: jest.fn(
        () => new Promise<ToolStandingAuthorization[]>(() => {}),
      ),
    };
    await expect(
      authorizeStandingWork({ toolName: 'read_file' }, { storage, scope, timeoutMs: 5 }),
    ).resolves.toEqual({ allowed: false, reason: 'unavailable' });
  });

  test('a revocation binds the next call, read through real storage', async () => {
    const id = await createGrant();
    await expect(
      authorizeStandingWork({ toolName: 'read_file' }, { storage, scope }),
    ).resolves.toEqual({ allowed: true, authorizationId: id });

    await expect(storage.revokeToolStandingAuthorization(scope, id)).resolves.toBe(true);

    /* Storage hides revoked grants, so the next lookup misses rather than reusing one. */
    await expect(
      authorizeStandingWork({ toolName: 'read_file' }, { storage, scope }),
    ).resolves.toEqual({ allowed: false, reason: 'no-match' });
  });
});
