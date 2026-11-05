import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { Collection } from 'mongodb';
import type { MongoSwarmLeaseDocument, MongoSwarmScope } from './swarmMongoStore';
import type { SwarmClaimResult, SwarmLease } from './swarm';
import { createMongoSwarmStore } from './swarmMongoStore';
import { SwarmCoordinator } from './swarm';

const owner: MongoSwarmScope = { userId: 'owner-a', tenantId: 'tenant-a', runId: 'run-a' };
const task = { id: 'task-a', requiredTools: ['read'] };
const peerA = { id: 'peer-a', tools: ['read'] };
const peerB = { id: 'peer-b', tools: ['read'] };

function claimed(result: SwarmClaimResult): SwarmLease {
  if (!result.ok) {
    throw new Error('Expected a successful lease claim');
  }
  return result.lease;
}

describe('durable Mongo swarm lease store', () => {
  let mongo: MongoMemoryServer;
  let client: MongoClient;
  let collection: Collection<MongoSwarmLeaseDocument>;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    client = new MongoClient(mongo.getUri());
    await client.connect();
    collection = client.db('swarm-test').collection<MongoSwarmLeaseDocument>('leases');
  }, 60_000);

  afterEach(async () => {
    await collection.deleteMany({});
  });

  afterAll(async () => {
    await client?.close();
    await mongo?.stop();
  });

  function coordinator(scope: MongoSwarmScope, peer: string, now: () => number) {
    return new SwarmCoordinator({
      store: createMongoSwarmStore(collection, scope),
      allowedTools: ['read'],
      leaseMs: 100,
      maxAttempts: 3,
      now,
      createLeaseId: () => `lease-${peer}`,
    });
  }

  it('arbitrates two independent coordinators on one durable Mongo document', async () => {
    const now = () => 1_000;
    const first = coordinator(owner, 'first', now);
    const second = coordinator(owner, 'second', now);

    const outcomes = await Promise.all([first.claim(peerA, task), second.claim(peerB, task)]);
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.filter((outcome) => !outcome.ok)).toHaveLength(1);
    expect(await collection.countDocuments({})).toBe(1);

    const winner = outcomes.find((outcome) => outcome.ok);
    if (!winner) {
      throw new Error('Expected one winning Mongo lease claim');
    }
    const lease = claimed(winner);
    expect((await createMongoSwarmStore(collection, owner).get(task.id))?.leaseId).toBe(
      lease.leaseId,
    );
  });

  it('fences a stale peer after expiry and reassignment across instances', async () => {
    let currentTime = 1_000;
    const now = () => currentTime;
    const first = coordinator(owner, 'first', now);
    const second = coordinator(owner, 'second', now);
    const oldLease = claimed(await first.claim(peerA, task));

    currentTime += 101;
    const newLease = claimed(await second.claim(peerB, task));
    expect(newLease.attempt).toBe(2);
    await expect(first.complete(peerA, task.id, oldLease.leaseId, 'stale')).resolves.toEqual({
      ok: false,
      reason: 'lease_lost',
    });
    await expect(first.release(peerA, task.id, oldLease.leaseId)).resolves.toEqual({
      ok: false,
      reason: 'lease_lost',
    });
    await expect(second.complete(peerB, task.id, newLease.leaseId, 'verified')).resolves.toEqual({
      ok: true,
      status: 'completed',
    });
    expect((await createMongoSwarmStore(collection, owner).get(task.id))?.result).toBe('verified');
  });

  it('preserves a completed lease across newly constructed stores', async () => {
    const now = () => 1_000;
    const first = coordinator(owner, 'first', now);
    const lease = claimed(await first.claim(peerA, task));
    await expect(first.complete(peerA, task.id, lease.leaseId, 'result')).resolves.toMatchObject({
      ok: true,
    });
    const restored = coordinator(owner, 'restored', now);
    await expect(restored.claim(peerB, task)).resolves.toEqual({
      ok: false,
      reason: 'already_completed',
    });
    await expect(first.complete(peerA, task.id, lease.leaseId, 'result')).resolves.toEqual({
      ok: true,
      status: 'already_completed',
    });
  });

  it('isolates the same task identifier by user, tenant and run', async () => {
    const now = () => 1_000;
    const scopes: MongoSwarmScope[] = [
      owner,
      { ...owner, userId: 'owner-b' },
      { ...owner, tenantId: 'tenant-b' },
      { ...owner, tenantId: null },
      { ...owner, runId: 'run-b' },
    ];
    for (const [index, scope] of scopes.entries()) {
      const result = await coordinator(scope, String(index), now).claim(peerA, task);
      expect(result.ok).toBe(true);
    }
    expect(await collection.countDocuments({})).toBe(scopes.length);
    for (const scope of scopes) {
      expect((await createMongoSwarmStore(collection, scope).get(task.id))?.attempt).toBe(1);
    }
  });

  it('fences replacement and deletion from a stale lease ID or state', async () => {
    const store = createMongoSwarmStore(collection, owner);
    const lease = claimed(await coordinator(owner, 'first', () => 1_000).claim(peerA, task));
    const next: SwarmLease = {
      ...lease,
      leaseId: 'lease-next',
      attempt: lease.attempt + 1,
      expiresAt: lease.expiresAt + 100,
    };
    const staleId = { leaseId: 'lease-old', state: lease.state };
    const staleState = { leaseId: lease.leaseId, state: 'completed' as const };

    await expect(store.compareAndSwap(task.id, staleId, next)).resolves.toBe(false);
    await expect(store.compareAndSwap(task.id, staleState, next)).resolves.toBe(false);
    await expect(store.compareAndSwap(task.id, staleId, null)).resolves.toBe(false);

    await expect(store.get(task.id)).resolves.toEqual(lease);
  });

  it('fails closed on missing scope and mismatched CAS task IDs', async () => {
    expect(() => createMongoSwarmStore(collection, { ...owner, userId: '' })).toThrow(
      /authenticated owner/,
    );
    const store = createMongoSwarmStore(collection, owner);
    await expect(
      store.compareAndSwap('expected', null, {
        taskId: 'unexpected',
        leaseId: 'l1',
        peerId: 'p1',
        attempt: 1,
        expiresAt: 100,
        state: 'claimed',
      }),
    ).rejects.toThrow(/task ID/);
    expect(await collection.countDocuments({})).toBe(0);
  });
});
