import mongoose from 'mongoose';
import { logger, createModels } from '..';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createToolStandingAuthorizationMethods } from './toolStandingAuthorization';

logger.silent = true;

let ToolStandingAuthorization: mongoose.Model<unknown>;
let methods: ReturnType<typeof createToolStandingAuthorizationMethods>;
let mongoServer: MongoMemoryServer;

const userA = new mongoose.Types.ObjectId().toString();
const userB = new mongoose.Types.ObjectId().toString();

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  ToolStandingAuthorization = mongoose.models.ToolStandingAuthorization;
  await ToolStandingAuthorization.syncIndexes();
  methods = createToolStandingAuthorizationMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await ToolStandingAuthorization.deleteMany({});
});

describe('createToolStandingAuthorization', () => {
  test('persists a normalized zero-cost grant for its owner', async () => {
    const created = await methods.createToolStandingAuthorization(
      { userId: userA },
      { label: ' Reads ', tools: [' read_file ', 'read_file'] },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value).toMatchObject({
      label: 'Reads',
      tools: ['read_file'],
      maxCostUsd: 0,
    });

    const listed = await methods.listToolStandingAuthorizations({ userId: userA });
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(created.value.id);
  });

  test('refuses a grant that would cover spend', async () => {
    const created = await methods.createToolStandingAuthorization(
      { userId: userA },
      { label: 'Paid reads', tools: ['read_file'], maxCostUsd: 1 },
    );
    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect(created.error.code).toBe('cost');
    expect(await ToolStandingAuthorization.countDocuments({})).toBe(0);
  });
});

describe('listToolStandingAuthorizations', () => {
  test('never returns another owner or tenant scope', async () => {
    await methods.createToolStandingAuthorization({ userId: userA }, { label: 'a', tools: ['a'] });
    await methods.createToolStandingAuthorization(
      { userId: userA, tenantId: 'tenant-2' },
      { label: 'tenant', tools: ['b'] },
    );
    await methods.createToolStandingAuthorization({ userId: userB }, { label: 'b', tools: ['c'] });

    const listed = await methods.listToolStandingAuthorizations({ userId: userA });
    expect(listed.map((item) => item.label)).toEqual(['a']);
  });

  test('round-trips expiry and hides revoked grants unless asked', async () => {
    const created = await methods.createToolStandingAuthorization(
      { userId: userA },
      { label: 'expiring', tools: ['read_file'], expiresAt: Date.now() + 60_000 },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const [active] = await methods.listToolStandingAuthorizations({ userId: userA });
    expect(active.expiresAt).toBe(created.value.expiresAt);

    await expect(
      methods.revokeToolStandingAuthorization({ userId: userA }, created.value.id),
    ).resolves.toBe(true);

    expect(await methods.listToolStandingAuthorizations({ userId: userA })).toEqual([]);
    const all = await methods.listToolStandingAuthorizations(
      { userId: userA },
      { includeRevoked: true },
    );
    expect(all).toHaveLength(1);
    expect(typeof all[0].revokedAt).toBe('number');
  });
});

describe('revokeToolStandingAuthorization', () => {
  test('cannot revoke a grant owned by someone else', async () => {
    const created = await methods.createToolStandingAuthorization(
      { userId: userA },
      { label: 'owned', tools: ['read_file'] },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await expect(
      methods.revokeToolStandingAuthorization({ userId: userB }, created.value.id),
    ).resolves.toBe(false);
    expect(await methods.listToolStandingAuthorizations({ userId: userA })).toHaveLength(1);
  });

  test('rejects a malformed identifier without touching storage', async () => {
    await expect(
      methods.revokeToolStandingAuthorization({ userId: userA }, 'not-an-id'),
    ).resolves.toBe(false);
  });
});
