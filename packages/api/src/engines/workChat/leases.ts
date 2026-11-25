import type {
  WorkRunCancelOutcome,
  WorkRunLeaseSnapshot,
  WorkRunMethods,
} from '@coderax/data-schemas';
import type { RunScope } from './types';

export type { WorkRunCancelOutcome, WorkRunLeaseSnapshot };

/**
 * Work run leases outlive the process that started a run.
 *
 * A run heartbeats its lease; a restart, a crash or a cancellation handled by a
 * different replica is therefore visible to everyone. The TTL bounds how long a
 * dead run can still report itself as running, and the same window is how long
 * another replica stays fenced out of the task.
 */
export const DEFAULT_WORK_RUN_LEASE_TTL_MS = 30_000;

/**
 * How long a dead run's row stays readable after its lease expires. The row is
 * what tells a client that a crashed run failed, so it outlives the lease for a
 * day; only then may a cleanup sweep reclaim it.
 */
export const DEFAULT_WORK_RUN_RETENTION_MS: number = 24 * 60 * 60 * 1000;

/** Rows one cleanup sweep may delete, so a large backlog stays bounded. */
export const WORK_RUN_SWEEP_LIMIT = 100;

export type WorkRunLeaseClaim = {
  token: string;
  owner: string;
  now: Date;
  expiresAt: Date;
};

export type WorkRunLeaseStore = {
  read: (scope: RunScope, now: Date) => Promise<WorkRunLeaseSnapshot | null>;
  claim: (scope: RunScope, claim: WorkRunLeaseClaim) => Promise<boolean>;
  renew: (
    scope: RunScope,
    token: string,
    now: Date,
    expiresAt: Date,
  ) => Promise<{ renewed: boolean; cancelRequested: boolean }>;
  cancel: (scope: RunScope, now: Date) => Promise<WorkRunCancelOutcome>;
  release: (scope: RunScope, token: string) => Promise<boolean>;
  /** Deletes at most `limit` rows whose lease expired before `before`. */
  prune: (before: Date, limit: number) => Promise<number>;
};

/** Tenant, owner and conversation together identify one Work task. */
export function workRunKey(scope: RunScope): string {
  return JSON.stringify([scope.tenantId ?? '', scope.userId, scope.conversationId]);
}

/** The database methods this store adapts; the CJS route supplies the app's db. */
export type WorkRunDb = WorkRunMethods;

/** Durable leases backed by the Work run collection. */
export function createWorkRunLeaseStore(db: WorkRunDb): WorkRunLeaseStore {
  return {
    read: (scope, now) => db.readWorkRun({ key: workRunKey(scope), now }),
    claim: (scope, claim) =>
      db.claimWorkRun({
        key: workRunKey(scope),
        user: scope.userId,
        conversationId: scope.conversationId,
        token: claim.token,
        owner: claim.owner,
        now: claim.now,
        expiresAt: claim.expiresAt,
      }),
    renew: (scope, token, now, expiresAt) =>
      db.renewWorkRun({ key: workRunKey(scope), token, now, expiresAt }),
    cancel: (scope, now) => db.cancelWorkRun({ key: workRunKey(scope), now }),
    release: (scope, token) => db.releaseWorkRun({ key: workRunKey(scope), token }),
    prune: (before, limit) => db.pruneWorkRuns({ before, limit }),
  };
}

type MemoryLease = {
  token: string;
  cancelRequested: boolean;
  expiresAt: Date;
};

/**
 * Process-local leases with the same contract as the database store. This is
 * the default so a deployment without a database still guards one process; it
 * cannot see a restart, which is why the API routes wire the durable store.
 */
export function createMemoryWorkRunLeaseStore(): WorkRunLeaseStore {
  const leases = new Map<string, MemoryLease>();
  return {
    read: async (scope, now) => {
      const lease = leases.get(workRunKey(scope));
      if (!lease) {
        return null;
      }
      return {
        token: lease.token,
        cancelRequested: lease.cancelRequested,
        expiresAt: lease.expiresAt,
        live: lease.expiresAt.getTime() > now.getTime(),
      };
    },
    claim: async (scope, claim) => {
      const key = workRunKey(scope);
      const existing = leases.get(key);
      if (existing && existing.expiresAt.getTime() > claim.now.getTime()) {
        return false;
      }
      leases.set(key, {
        token: claim.token,
        cancelRequested: false,
        expiresAt: claim.expiresAt,
      });
      return true;
    },
    renew: async (scope, token, now, expiresAt) => {
      const lease = leases.get(workRunKey(scope));
      if (!lease || lease.token !== token || lease.expiresAt.getTime() <= now.getTime()) {
        return { renewed: false, cancelRequested: false };
      }
      lease.expiresAt = expiresAt;
      return { renewed: true, cancelRequested: lease.cancelRequested };
    },
    cancel: async (scope, now) => {
      const key = workRunKey(scope);
      const lease = leases.get(key);
      if (!lease) {
        return 'none';
      }
      if (lease.expiresAt.getTime() > now.getTime()) {
        lease.cancelRequested = true;
        return 'requested';
      }
      leases.delete(key);
      return 'interrupted';
    },
    release: async (scope, token) => {
      const key = workRunKey(scope);
      if (leases.get(key)?.token !== token) {
        return false;
      }
      leases.delete(key);
      return true;
    },
    prune: async (before, limit) => {
      let pruned = 0;
      for (const [key, lease] of leases) {
        if (pruned >= limit) {
          break;
        }
        if (lease.expiresAt.getTime() <= before.getTime()) {
          leases.delete(key);
          pruned += 1;
        }
      }
      return pruned;
    },
  };
}

/** Shared default leases for runtimes constructed without an explicit store. */
export const memoryWorkRunLeases: WorkRunLeaseStore = createMemoryWorkRunLeaseStore();
