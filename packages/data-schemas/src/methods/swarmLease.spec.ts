import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { Collection } from 'mongodb';
import type { SwarmLeaseDocument, SwarmLeaseRecord } from './swarmLease';
import { createSwarmLeaseRepository } from './swarmLease';

const KEY = '["owner-a","tenant-a","run-a","task-a"]';

function lease(overrides: Partial<SwarmLeaseRecord> = {}): SwarmLeaseRecord {
  return {
    taskId: 'task-a',
    leaseId: 'lease-1',
    peerId: 'peer-a',
    attempt: 1,
    expiresAt: 1_000,
    state: 'claimed',
    ...overrides,
  };
}

describe('durable swarm lease repository', () => {
  let mongo: MongoMemoryServer;
  let client: MongoClient;
  let collection: Collection<SwarmLeaseDocument>;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    client = new MongoClient(mongo.getUri());
    await client.connect();
    collection = client.db('swarm-test').collection<SwarmLeaseDocument>('leases');
  }, 60_000);

  afterEach(async () => {
    await collection.deleteMany({});
  });

  afterAll(async () => {
    await client?.close();
    await mongo?.stop();
  });

  it('creates one lease per key and reports a duplicate claim as a conflict', async () => {
    const repository = createSwarmLeaseRepository(collection);

    await expect(repository.insert(KEY, lease())).resolves.toBe(true);
    await expect(
      repository.insert(KEY, lease({ leaseId: 'lease-2', peerId: 'peer-b' })),
    ).resolves.toBe(false);

    await expect(repository.read(KEY)).resolves.toMatchObject({ leaseId: 'lease-1' });
    await expect(collection.countDocuments({})).resolves.toBe(1);
  });

  it('rejects a replacement with an old lease ID and leaves the row unchanged', async () => {
    const repository = createSwarmLeaseRepository(collection);
    await repository.insert(KEY, lease());

    await expect(
      repository.replace(
        KEY,
        { leaseId: 'lease-old', state: 'claimed' },
        lease({ leaseId: 'lease-2', peerId: 'peer-b', attempt: 2 }),
      ),
    ).resolves.toBe(false);

    await expect(repository.read(KEY)).resolves.toMatchObject({
      leaseId: 'lease-1',
      peerId: 'peer-a',
      attempt: 1,
    });
  });

  it('rejects a replacement with the right lease ID but an old state', async () => {
    const repository = createSwarmLeaseRepository(collection);
    await repository.insert(KEY, lease());

    await expect(
      repository.replace(
        KEY,
        { leaseId: 'lease-1', state: 'completed' },
        lease({ leaseId: 'lease-2', peerId: 'peer-b', attempt: 2 }),
      ),
    ).resolves.toBe(false);

    await expect(repository.read(KEY)).resolves.toMatchObject({
      leaseId: 'lease-1',
      state: 'claimed',
    });
  });

  it('deletes only when both lease ID and state match', async () => {
    const repository = createSwarmLeaseRepository(collection);
    await repository.insert(KEY, lease());

    await expect(
      repository.remove(KEY, { leaseId: 'lease-old', state: 'claimed' }),
    ).resolves.toBe(false);
    await expect(
      repository.remove(KEY, { leaseId: 'lease-1', state: 'completed' }),
    ).resolves.toBe(false);
    await expect(repository.read(KEY)).resolves.not.toBeNull();

    await expect(repository.remove(KEY, { leaseId: 'lease-1', state: 'claimed' })).resolves.toBe(
      true,
    );
    await expect(repository.read(KEY)).resolves.toBeNull();
  });

  it('clears a completed result when a later attempt replaces the lease', async () => {
    const repository = createSwarmLeaseRepository(collection);
    await repository.insert(KEY, lease());
    await repository.replace(
      KEY,
      { leaseId: 'lease-1', state: 'claimed' },
      lease({ state: 'completed', result: 'verified' }),
    );

    await repository.replace(
      KEY,
      { leaseId: 'lease-1', state: 'completed' },
      lease({ leaseId: 'lease-2', peerId: 'peer-b', attempt: 2 }),
    );

    await expect(repository.read(KEY)).resolves.toEqual(lease({ leaseId: 'lease-2', peerId: 'peer-b', attempt: 2 }));
  });
});
