import type { WorkRunDb } from './leases';
import type { RunScope } from './types';
import { createMemoryWorkRunLeaseStore, createWorkRunLeaseStore, workRunKey } from './leases';

const scope = (
  conversationId: string,
  overrides: { userId?: string; tenantId?: string | null } = {},
): RunScope => ({
  userId: overrides.userId ?? 'owner',
  tenantId: overrides.tenantId === undefined ? 'tenant-1' : overrides.tenantId,
  conversationId,
});

function claimFor(token: string, owner = 'instance-1') {
  const now = new Date();
  return { token, owner, now, expiresAt: new Date(now.getTime() + 30_000) };
}

describe('Work run lease store', () => {
  it('keys a run by tenant, owner and conversation', () => {
    expect(workRunKey(scope('conversation-a'))).not.toBe(
      workRunKey(scope('conversation-a', { tenantId: 'tenant-2' })),
    );
    expect(workRunKey(scope('conversation-a'))).not.toBe(
      workRunKey(scope('conversation-a', { userId: 'other' })),
    );
    expect(workRunKey(scope('conversation-a'))).not.toBe(workRunKey(scope('conversation-b')));
  });

  it('lets one holder claim a task and refuses a second live claim', async () => {
    const leases = createMemoryWorkRunLeaseStore();
    const input = scope('conversation-a');

    await expect(leases.claim(input, claimFor('token-1'))).resolves.toEqual({
      claimed: true,
      previousToken: null,
    });
    await expect(leases.claim(input, claimFor('token-2'))).resolves.toEqual({
      claimed: false,
      previousToken: null,
    });
    await expect(leases.read(input, new Date())).resolves.toMatchObject({ live: true });
  });

  it('renews only the owning unexpired lease', async () => {
    const leases = createMemoryWorkRunLeaseStore();
    const input = scope('conversation-a');
    const claim = claimFor('token-1');
    await leases.claim(input, claim);

    await expect(
      leases.renew(input, 'token-2', new Date(), new Date(Date.now() + 60_000)),
    ).resolves.toEqual({ renewed: false, cancelRequested: false });

    const expiresAt = new Date(Date.now() + 60_000);
    await expect(leases.renew(input, 'token-1', new Date(), expiresAt)).resolves.toEqual({
      renewed: true,
      cancelRequested: false,
    });
    await expect(leases.read(input, new Date())).resolves.toMatchObject({ expiresAt });
  });

  it('flags a live run so its owner observes the cancellation', async () => {
    const leases = createMemoryWorkRunLeaseStore();
    const input = scope('conversation-a');
    await leases.claim(input, claimFor('token-1'));

    await expect(leases.cancel(input, new Date())).resolves.toBe('requested');
    await expect(
      leases.renew(input, 'token-1', new Date(), new Date(Date.now() + 60_000)),
    ).resolves.toEqual({ renewed: true, cancelRequested: true });
  });

  it('retires an expired run instead of flagging a lease nobody holds', async () => {
    const leases = createMemoryWorkRunLeaseStore();
    const input = scope('conversation-a');
    const now = new Date();
    await leases.claim(input, {
      token: 'dead-token',
      owner: 'previous-boot',
      now: new Date(now.getTime() - 120_000),
      expiresAt: new Date(now.getTime() - 60_000),
    });

    await expect(leases.read(input, now)).resolves.toMatchObject({ live: false });
    await expect(leases.cancel(input, now)).resolves.toBe('interrupted');
    await expect(leases.read(input, now)).resolves.toBeNull();
    await expect(leases.claim(input, claimFor('token-2'))).resolves.toEqual({
      claimed: true,
      previousToken: null,
    });
  });

  it('reports nothing to cancel for an unknown task', async () => {
    const leases = createMemoryWorkRunLeaseStore();
    await expect(leases.cancel(scope('conversation-a'), new Date())).resolves.toBe('none');
  });

  it('releases only the owning token', async () => {
    const leases = createMemoryWorkRunLeaseStore();
    const input = scope('conversation-a');
    await leases.claim(input, claimFor('token-1'));

    await expect(leases.release(input, 'token-2')).resolves.toBe(false);
    await expect(leases.release(input, 'token-1')).resolves.toBe(true);
    await expect(leases.read(input, new Date())).resolves.toBeNull();
  });

  it('reclaims dead leases in bounded batches and keeps recent ones', async () => {
    const leases = createMemoryWorkRunLeaseStore();
    const now = new Date();
    const dead = new Date(now.getTime() - 2 * 60 * 60_000);
    const recent = new Date(now.getTime() - 60_000);
    const cutoff = new Date(now.getTime() - 60 * 60_000);

    for (const id of ['a', 'b', 'c']) {
      await leases.claim(scope(`dead-${id}`), {
        token: `token-${id}`,
        owner: 'previous-boot',
        now: dead,
        expiresAt: dead,
      });
    }
    await leases.claim(scope('recent'), {
      token: 'recent',
      owner: 'gone',
      now: recent,
      expiresAt: recent,
    });
    await leases.claim(scope('live'), claimFor('token-live'));

    await expect(leases.prune(cutoff, 2)).resolves.toBe(2);
    await expect(leases.prune(cutoff, 2)).resolves.toBe(1);
    await expect(leases.prune(cutoff, 2)).resolves.toBe(0);
    await expect(leases.read(scope('dead-a'), now)).resolves.toBeNull();
    await expect(leases.read(scope('dead-b'), now)).resolves.toBeNull();
    await expect(leases.read(scope('dead-c'), now)).resolves.toBeNull();
    await expect(leases.read(scope('recent'), now)).resolves.toMatchObject({ live: false });
    await expect(leases.read(scope('live'), now)).resolves.toMatchObject({ live: true });
  });

  it('addresses the database methods with the run key and request scope', async () => {
    const db = {
      claimWorkRun: jest.fn(async () => true),
      claimWorkRunLease: jest.fn(async () => ({ claimed: true, previousToken: null })),
      renewWorkRun: jest.fn(async () => ({ renewed: true, cancelRequested: false })),
      releaseWorkRun: jest.fn(async () => true),
      cancelWorkRun: jest.fn(async () => 'requested' as const),
      readWorkRun: jest.fn(async () => null),
      pruneWorkRuns: jest.fn(async () => 3),
    } satisfies WorkRunDb;
    const leases = createWorkRunLeaseStore(db);
    const input = scope('conversation-a');
    const claim = claimFor('token-1');
    const key = workRunKey(input);

    await expect(leases.claim(input, claim)).resolves.toEqual({
      claimed: true,
      previousToken: null,
    });
    expect(db.claimWorkRunLease).toHaveBeenCalledWith({
      key,
      user: 'owner',
      conversationId: 'conversation-a',
      token: 'token-1',
      owner: 'instance-1',
      now: claim.now,
      expiresAt: claim.expiresAt,
    });

    await leases.renew(input, 'token-1', claim.now, claim.expiresAt);
    expect(db.renewWorkRun).toHaveBeenCalledWith({
      key,
      token: 'token-1',
      now: claim.now,
      expiresAt: claim.expiresAt,
    });

    await expect(leases.cancel(input, claim.now)).resolves.toBe('requested');
    expect(db.cancelWorkRun).toHaveBeenCalledWith({ key, now: claim.now });

    await leases.cancel(input, claim.now, 'token-1');
    expect(db.cancelWorkRun).toHaveBeenLastCalledWith({
      key,
      now: claim.now,
      token: 'token-1',
    });

    await leases.release(input, 'token-1');
    expect(db.releaseWorkRun).toHaveBeenCalledWith({ key, token: 'token-1' });

    await leases.read(input, claim.now);
    expect(db.readWorkRun).toHaveBeenCalledWith({ key, now: claim.now });

    const before = new Date(claim.now.getTime() - 3_600_000);
    await expect(leases.prune(before, 25)).resolves.toBe(3);
    expect(db.pruneWorkRuns).toHaveBeenCalledWith({ before, limit: 25 });
  });
});
