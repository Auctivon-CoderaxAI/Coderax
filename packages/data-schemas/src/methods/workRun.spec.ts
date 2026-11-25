import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createWorkRunMethods } from './workRun';
import { createModels } from '~/models';

let WorkRun: mongoose.Model<unknown>;
let methods: ReturnType<typeof createWorkRunMethods>;
let mongoServer: MongoMemoryServer;

const KEY = 'tenant-1:owner:conversation-1';

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  WorkRun = mongoose.models.WorkRun;
  await WorkRun.syncIndexes();
  methods = createWorkRunMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await WorkRun.deleteMany({});
});

const claim = (token: string, overrides: { now?: Date; expiresAt?: Date } = {}) => {
  const now = overrides.now ?? new Date();
  return {
    key: KEY,
    user: 'owner',
    conversationId: 'conversation-1',
    token,
    owner: 'instance-1',
    now,
    expiresAt: overrides.expiresAt ?? new Date(now.getTime() + 30_000),
  };
};

describe('Work run lease methods', () => {
  test('claims a task once and refuses a second live claim', async () => {
    await expect(methods.claimWorkRun(claim('token-1'))).resolves.toBe(true);
    await expect(methods.claimWorkRun(claim('token-2'))).resolves.toBe(false);

    await expect(methods.readWorkRun({ key: KEY, now: new Date() })).resolves.toMatchObject({
      /** The token is the generation a conversation write is fenced to. */
      token: 'token-1',
      cancelRequested: false,
      live: true,
    });
  });

  test('resolves concurrent claims to one holder at the unique key index', async () => {
    const results = await Promise.all([
      methods.claimWorkRun(claim('token-a')),
      methods.claimWorkRun(claim('token-b')),
      methods.claimWorkRun(claim('token-c')),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await WorkRun.countDocuments({})).toBe(1);
  });

  test('renews only the owning unexpired lease', async () => {
    await methods.claimWorkRun(claim('token-1'));

    await expect(
      methods.renewWorkRun({
        key: KEY,
        token: 'token-2',
        now: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).resolves.toEqual({ renewed: false, cancelRequested: false });

    const expiresAt = new Date(Date.now() + 60_000);
    await expect(
      methods.renewWorkRun({ key: KEY, token: 'token-1', now: new Date(), expiresAt }),
    ).resolves.toEqual({ renewed: true, cancelRequested: false });
    await expect(methods.readWorkRun({ key: KEY, now: new Date() })).resolves.toMatchObject({
      expiresAt,
    });
  });

  test('flags a live lease so an owner on another replica observes the cancellation', async () => {
    await methods.claimWorkRun(claim('token-1'));

    await expect(methods.cancelWorkRun({ key: KEY, now: new Date() })).resolves.toBe('requested');
    await expect(
      methods.renewWorkRun({
        key: KEY,
        token: 'token-1',
        now: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).resolves.toEqual({ renewed: true, cancelRequested: true });
  });

  test('retires an expired lease that no process can still own', async () => {
    const now = new Date();
    await methods.claimWorkRun(
      claim('dead-token', {
        now: new Date(now.getTime() - 120_000),
        expiresAt: new Date(now.getTime() - 60_000),
      }),
    );

    await expect(methods.readWorkRun({ key: KEY, now })).resolves.toMatchObject({ live: false });
    await expect(methods.cancelWorkRun({ key: KEY, now })).resolves.toBe('interrupted');
    await expect(methods.readWorkRun({ key: KEY, now })).resolves.toBeNull();
  });

  test('reports nothing to cancel for an unknown task', async () => {
    await expect(
      methods.cancelWorkRun({ key: 'tenant-1:owner:conversation-2', now: new Date() }),
    ).resolves.toBe('none');
  });

  test('reclaims an expired lease for a new run', async () => {
    const now = new Date();
    await methods.claimWorkRun(
      claim('dead-token', {
        now: new Date(now.getTime() - 120_000),
        expiresAt: new Date(now.getTime() - 60_000),
      }),
    );

    await expect(methods.claimWorkRun(claim('token-2'))).resolves.toBe(true);
    await expect(methods.readWorkRun({ key: KEY, now })).resolves.toMatchObject({ live: true });
  });

  test('releases only the owning token and leaves the task claimable', async () => {
    await methods.claimWorkRun(claim('token-1'));

    await expect(methods.releaseWorkRun({ key: KEY, token: 'token-2' })).resolves.toBe(false);
    await expect(methods.releaseWorkRun({ key: KEY, token: 'token-1' })).resolves.toBe(true);
    await expect(methods.readWorkRun({ key: KEY, now: new Date() })).resolves.toBeNull();
    await expect(methods.claimWorkRun(claim('token-2'))).resolves.toBe(true);
  });

  test('keeps the same conversation independent across tenants', async () => {
    await methods.claimWorkRun(claim('token-tenant-1'));
    await methods.claimWorkRun({
      ...claim('token-tenant-2'),
      key: 'tenant-2:owner:conversation-1',
    });

    expect(await WorkRun.countDocuments({})).toBe(2);
    await expect(
      methods.readWorkRun({ key: 'tenant-2:owner:conversation-1', now: new Date() }),
    ).resolves.toMatchObject({ live: true });
    /** Each tenant holds its own token, so one tenant's lease cannot renew another's. */
    await expect(
      methods.renewWorkRun({
        key: 'tenant-2:owner:conversation-1',
        token: 'token-tenant-1',
        now: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).resolves.toEqual({ renewed: false, cancelRequested: false });
  });

  test('reclaims rows left by a dead process in bounded batches', async () => {
    const now = new Date();
    const dead = new Date(now.getTime() - 2 * 60 * 60_000);
    const recent = new Date(now.getTime() - 60_000);

    for (const id of ['a', 'b', 'c']) {
      await methods.claimWorkRun({
        ...claim(`token-${id}`, { now: dead, expiresAt: dead }),
        key: `tenant-1:owner:conversation-${id}`,
        conversationId: `conversation-${id}`,
      });
    }
    await methods.claimWorkRun({
      ...claim('token-recent', { now: recent, expiresAt: recent }),
      key: 'tenant-1:owner:conversation-recent',
      conversationId: 'conversation-recent',
    });
    await methods.claimWorkRun(claim('token-live'));

    const before = new Date(now.getTime() - 60 * 60_000);
    await expect(methods.pruneWorkRuns({ before, limit: 2 })).resolves.toBe(2);
    await expect(methods.pruneWorkRuns({ before, limit: 2 })).resolves.toBe(1);
    await expect(methods.pruneWorkRuns({ before, limit: 2 })).resolves.toBe(0);
    /** The retention window keeps a recently failed run readable. */
    expect(await WorkRun.countDocuments({})).toBe(2);
    await expect(
      methods.readWorkRun({ key: 'tenant-1:owner:conversation-recent', now }),
    ).resolves.toMatchObject({ live: false });
    await expect(methods.readWorkRun({ key: KEY, now })).resolves.toMatchObject({ live: true });
  });
});
