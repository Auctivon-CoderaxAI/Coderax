import type { SwarmClaimResult, SwarmLease } from './swarm';
import { SwarmCoordinator, createMemorySwarmStore } from './swarm';

const task = { id: 'task-1', requiredTools: ['read'] };
const peerA = { id: 'peer-a', tools: ['read', 'write'] };
const peerB = { id: 'peer-b', tools: ['read', 'write'] };

function setup(options: { maxAttempts?: number } = {}) {
  let now = 1_000;
  let sequence = 0;
  const store = createMemorySwarmStore();
  const coordinator = new SwarmCoordinator({
    store,
    allowedTools: ['read', 'write'],
    now: () => now,
    leaseMs: 100,
    maxAttempts: options.maxAttempts ?? 2,
    createLeaseId: () => `lease-${++sequence}`,
  });
  return {
    coordinator,
    store,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function claimed(result: SwarmClaimResult): SwarmLease {
  if (!result.ok) {
    throw new Error(`expected a claim, received ${result.reason}`);
  }
  return result.lease;
}

describe('SwarmCoordinator', () => {
  it('lets exactly one of two racing peers claim one offered task', async () => {
    const { coordinator } = setup();

    const results = await Promise.all([
      coordinator.claim(peerA, task),
      coordinator.claim(peerB, task),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const loser = results.find((result) => !result.ok);
    expect(loser && !loser.ok ? loser.reason : null).toMatch(/^(claim_conflict|unavailable)$/);
  });

  it('rejects a duplicate claim while the lease is live', async () => {
    const { coordinator } = setup();

    expect(claimed(await coordinator.claim(peerA, task)).peerId).toBe('peer-a');
    await expect(coordinator.claim(peerB, task)).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });

  it('reassigns an expired lease with an incremented attempt', async () => {
    const { coordinator, advance } = setup();

    const first = claimed(await coordinator.claim(peerA, task));
    expect(first.attempt).toBe(1);
    advance(101);

    const second = claimed(await coordinator.claim(peerB, task));
    expect(second).toMatchObject({ peerId: 'peer-b', attempt: 2 });
  });

  it('rejects completion from the peer whose lease was reassigned', async () => {
    const { coordinator, advance } = setup();

    const first = claimed(await coordinator.claim(peerA, task));
    advance(101);
    const second = claimed(await coordinator.claim(peerB, task));

    await expect(coordinator.complete(peerA, task.id, first.leaseId, 'stale')).resolves.toEqual({
      ok: false,
      reason: 'lease_lost',
    });
    await expect(coordinator.complete(peerB, task.id, second.leaseId, 'fresh')).resolves.toEqual({
      ok: true,
      status: 'completed',
    });
  });

  it('treats a repeated completion by the winning peer as idempotent', async () => {
    const { coordinator } = setup();

    const lease = claimed(await coordinator.claim(peerA, task));
    await expect(coordinator.complete(peerA, task.id, lease.leaseId, 'done')).resolves.toEqual({
      ok: true,
      status: 'completed',
    });
    await expect(coordinator.complete(peerA, task.id, lease.leaseId, 'done')).resolves.toEqual({
      ok: true,
      status: 'already_completed',
    });
    await expect(coordinator.claim(peerB, task)).resolves.toEqual({
      ok: false,
      reason: 'already_completed',
    });
  });

  it('allows another peer to claim after the owner releases the task', async () => {
    const { coordinator } = setup();

    const lease = claimed(await coordinator.claim(peerA, task));
    await expect(coordinator.release(peerA, task.id, lease.leaseId)).resolves.toEqual({
      ok: true,
      status: 'released',
    });

    const second = claimed(await coordinator.claim(peerB, task));
    expect(second).toMatchObject({ peerId: 'peer-b', attempt: 2 });
  });

  it('rejects stale completion and release when the same peer reclaims a task', async () => {
    const { coordinator, advance, store } = setup();
    const first = claimed(await coordinator.claim(peerA, task));
    advance(101);
    const second = claimed(await coordinator.claim(peerA, task));

    expect(second.leaseId).not.toBe(first.leaseId);
    await expect(coordinator.complete(peerA, task.id, first.leaseId, 'stale')).resolves.toEqual({
      ok: false,
      reason: 'lease_lost',
    });
    await expect(coordinator.release(peerA, task.id, first.leaseId)).resolves.toEqual({
      ok: false,
      reason: 'lease_lost',
    });
    expect(store.get(task.id)).toMatchObject({
      leaseId: second.leaseId,
      state: 'claimed',
    });
    await expect(coordinator.complete(peerA, task.id, second.leaseId, 'fresh')).resolves.toEqual({
      ok: true,
      status: 'completed',
    });
    await expect(coordinator.complete(peerA, task.id, first.leaseId, 'stale')).resolves.toEqual({
      ok: false,
      reason: 'lease_lost',
    });
    expect(store.get(task.id)).toMatchObject({
      leaseId: second.leaseId,
      state: 'completed',
      result: 'fresh',
    });
  });

  it('permits only one of simultaneous completion and release', async () => {
    const { coordinator, store } = setup();
    const lease = claimed(await coordinator.claim(peerA, task));

    const [completion, release] = await Promise.all([
      coordinator.complete(peerA, task.id, lease.leaseId, 'winner'),
      coordinator.release(peerA, task.id, lease.leaseId),
    ]);

    expect([completion.ok, release.ok].filter(Boolean)).toHaveLength(1);
    if (completion.ok) {
      expect(completion.status).toBe('completed');
      expect(release).toEqual({ ok: false, reason: 'lease_lost' });
      expect(store.get(task.id)).toMatchObject({
        state: 'completed',
        result: 'winner',
      });
      await expect(coordinator.claim(peerB, task)).resolves.toEqual({
        ok: false,
        reason: 'already_completed',
      });
    } else {
      expect(completion).toEqual({ ok: false, reason: 'lease_lost' });
      expect(release).toEqual({ ok: true, status: 'released' });
      expect(store.get(task.id)).toMatchObject({ state: 'released' });
    }
  });

  it('allows only one racing completion to set the result', async () => {
    const { coordinator, store } = setup();
    const lease = claimed(await coordinator.claim(peerA, task));

    const results = await Promise.all([
      coordinator.complete(peerA, task.id, lease.leaseId, 'first'),
      coordinator.complete(peerA, task.id, lease.leaseId, 'second'),
    ]);

    expect(results.filter((result) => result.ok && result.status === 'completed')).toHaveLength(1);
    expect(results.filter((result) => !result.ok && result.reason === 'lease_lost')).toHaveLength(
      1,
    );
    const winnerIndex = results.findIndex((result) => result.ok);
    expect(store.get(task.id)).toMatchObject({
      state: 'completed',
      result: winnerIndex === 0 ? 'first' : 'second',
    });
    await expect(coordinator.claim(peerB, task)).resolves.toEqual({
      ok: false,
      reason: 'already_completed',
    });
  });

  it('stops after the bounded attempt count instead of redispatching forever', async () => {
    const { coordinator, advance } = setup({ maxAttempts: 2 });

    claimed(await coordinator.claim(peerA, task));
    advance(101);
    claimed(await coordinator.claim(peerB, task));
    advance(101);

    await expect(coordinator.claim(peerA, task)).resolves.toEqual({
      ok: false,
      reason: 'attempts_exhausted',
    });
  });

  it('denies a task requiring a tool outside the coordinator ceiling', async () => {
    const { coordinator } = setup();

    await expect(
      coordinator.claim(
        { id: 'peer-admin', tools: ['read', 'admin'] },
        { id: 'task-admin', requiredTools: ['admin'] },
      ),
    ).resolves.toEqual({ ok: false, reason: 'tool_denied' });
  });

  it('denies a task requiring a tool the peer did not advertise', async () => {
    const { coordinator } = setup();

    await expect(
      coordinator.claim(
        { id: 'peer-read-only', tools: ['read'] },
        { id: 'task-write', requiredTools: ['write'] },
      ),
    ).resolves.toEqual({ ok: false, reason: 'tool_denied' });
  });

  it('grants only the tools required by the task, even when the peer can do more', async () => {
    const { coordinator } = setup();

    const result = await coordinator.claim(
      { id: 'peer-powerful', tools: ['read', 'write', 'admin'] },
      { id: 'task-read', requiredTools: ['read'] },
    );

    expect(result.ok && result.allowedTools).toEqual(['read']);
  });

  it('grants no tools to a task that declares no tool requirements', async () => {
    const { coordinator } = setup();

    const result = await coordinator.claim(
      { id: 'peer-powerful', tools: ['read', 'write', 'admin'] },
      { id: 'task-plain' },
    );

    expect(result.ok && result.allowedTools).toEqual([]);
  });

  it('deduplicates the explicitly requested and permitted task tools', async () => {
    const { coordinator } = setup();

    const result = await coordinator.claim(
      { id: 'peer-reader', tools: ['read', 'write'] },
      { id: 'task-duplicate', requiredTools: ['read', 'read'] },
    );

    expect(result.ok && result.allowedTools).toEqual(['read']);
  });

  it('snapshots required tools before awaiting the lease store', async () => {
    let resolveRead!: (lease: SwarmLease | null) => void;
    const store = {
      get: () =>
        new Promise<SwarmLease | null>((resolve) => {
          resolveRead = resolve;
        }),
      compareAndSwap: () => true,
    };
    const coordinator = new SwarmCoordinator({
      store,
      allowedTools: ['read', 'write'],
      now: () => 1_000,
      createLeaseId: () => 'lease-snapshot',
    });
    const requiredTools = ['read'];

    const pendingClaim = coordinator.claim(
      { id: 'peer-reader', tools: ['read', 'write'] },
      { id: 'task-snapshot', requiredTools },
    );
    requiredTools.push('write');
    resolveRead(null);

    const result = await pendingClaim;
    expect(result.ok && result.allowedTools).toEqual(['read']);
  });

  it('rejects malformed peer and task identities without writing a lease', async () => {
    const { coordinator, store } = setup();

    await expect(coordinator.claim({ id: '  ' }, task)).resolves.toEqual({
      ok: false,
      reason: 'invalid_peer',
    });
    await expect(coordinator.claim(peerA, { id: '' })).resolves.toEqual({
      ok: false,
      reason: 'invalid_task',
    });
    expect(store.get(task.id)).toBeNull();
  });

  it('rejects an oversized result without consuming the lease', async () => {
    const now = 1_000;
    const coordinator = new SwarmCoordinator({
      store: createMemorySwarmStore(),
      allowedTools: ['read'],
      now: () => now,
      leaseMs: 100,
      maxResultChars: 4,
      createLeaseId: () => 'lease-1',
    });

    const lease = claimed(
      await coordinator.claim(peerA, { id: 'task-small', requiredTools: ['read'] }),
    );
    await expect(
      coordinator.complete(peerA, 'task-small', lease.leaseId, 'too large'),
    ).resolves.toEqual({
      ok: false,
      reason: 'result_too_large',
    });
    await expect(coordinator.complete(peerA, 'task-small', lease.leaseId, 'ok')).resolves.toEqual({
      ok: true,
      status: 'completed',
    });
  });

  it('does not let a late peer overwrite another peer’s completed result', async () => {
    const { coordinator, advance, store } = setup();

    const first = claimed(await coordinator.claim(peerA, task));
    advance(101);
    const second = claimed(await coordinator.claim(peerB, task));
    await coordinator.complete(peerB, task.id, second.leaseId, 'winner');

    await expect(coordinator.complete(peerA, task.id, first.leaseId, 'stale')).resolves.toEqual({
      ok: false,
      reason: 'lease_lost',
    });
    expect(store.get(task.id)).toMatchObject({
      state: 'completed',
      peerId: 'peer-b',
      result: 'winner',
    });
  });

  it('reads every bound from app config and lets explicit options override them', async () => {
    let now = 1_000;
    const coordinator = new SwarmCoordinator({
      store: createMemorySwarmStore(),
      allowedTools: ['read'],
      now: () => now,
      config: { interface: { swarm: { leaseMs: 1_000, maxAttempts: 1, maxResultChars: 4 } } },
      createLeaseId: () => 'lease-config',
    });

    const lease = claimed(
      await coordinator.claim(peerA, { id: 'task-config', requiredTools: ['read'] }),
    );
    await expect(
      coordinator.complete(peerA, 'task-config', lease.leaseId, 'too large'),
    ).resolves.toEqual({ ok: false, reason: 'result_too_large' });
    now += 1_001;
    await expect(
      coordinator.claim(peerB, { id: 'task-config', requiredTools: ['read'] }),
    ).resolves.toEqual({ ok: false, reason: 'attempts_exhausted' });
  });
});
