import type { Collection } from 'mongodb';
import type { SwarmLease, SwarmLeaseStore } from './swarm';

/**
 * Durable swarm leases keyed by the authenticated owner, tenant, run and task.
 * The caller MUST populate scope from trusted request/run identity, never from
 * an unverified A2A payload. This adapter does not authorize agent/tool access;
 * the coordinator and its caller remain responsible for those checks.
 */
export interface MongoSwarmScope {
  userId: string;
  tenantId: string | null;
  runId: string;
}

export type MongoSwarmLeaseDocument = SwarmLease & { _id: string };

export type MongoSwarmCollection = Pick<
  Collection<MongoSwarmLeaseDocument>,
  'findOne' | 'insertOne' | 'replaceOne' | 'deleteOne'
>;

function isDuplicateKey(error: unknown): boolean {
  return error != null && typeof error === 'object' && 'code' in error && error.code === 11000;
}

function checkScope(scope: MongoSwarmScope): void {
  if (
    !scope ||
    typeof scope.userId !== 'string' ||
    scope.userId.trim().length === 0 ||
    scope.userId.length > 120 ||
    typeof scope.runId !== 'string' ||
    scope.runId.trim().length === 0 ||
    scope.runId.length > 120 ||
    (scope.tenantId !== null &&
      (typeof scope.tenantId !== 'string' ||
        scope.tenantId.trim().length === 0 ||
        scope.tenantId.length > 120))
  ) {
    throw new TypeError('Mongo swarm store requires an authenticated owner, run and tenant scope');
  }
}

/**
 * Atomic, cross-process compare-and-swap using Mongo's unique _id index.
 *
 * A missing key is created only through insertOne (duplicate-key loses the
 * race). Existing keys are replaced only when BOTH leaseId and state match,
 * fencing delayed completions and releases from earlier attempts. No upsert
 * can overwrite an existing lease, and a replacement clears stale fields.
 *
 * Unlike the in-memory test adapter, this store can survive process restarts.
 * It is still NOT wired into Chat/Work runtime; production use requires a
 * collection with acknowledged writes and real multi-worker certification.
 */
export function createMongoSwarmStore(
  collection: MongoSwarmCollection,
  scope: MongoSwarmScope,
): SwarmLeaseStore {
  if (!collection) {
    throw new TypeError('Mongo swarm store requires a Mongo collection');
  }
  checkScope(scope);
  const namespace = [scope.userId, scope.tenantId, scope.runId] as const;
  const keyFor = (taskId: string): string => JSON.stringify([...namespace, taskId]);

  return {
    async get(taskId) {
      const row = await collection.findOne({ _id: keyFor(taskId) });
      if (!row) {
        return null;
      }
      const { _id: _scopedKey, ...lease } = row;
      return lease;
    },

    async compareAndSwap(taskId, expected, next) {
      if (next != null && next.taskId !== taskId) {
        throw new TypeError('Swarm lease task ID does not match compare-and-swap key');
      }
      const _id = keyFor(taskId);
      if (expected == null) {
        if (next == null) {
          return false;
        }
        try {
          await collection.insertOne({ _id, ...next });
          return true;
        } catch (error) {
          if (isDuplicateKey(error)) {
            return false;
          }
          throw error;
        }
      }
      const filter = { _id, leaseId: expected.leaseId, state: expected.state };
      if (next == null) {
        return (await collection.deleteOne(filter)).deletedCount === 1;
      }
      /** `_id` is immutable and already pinned by the filter; a replacement carrying it is
       *  rejected by Mongo and by the driver's replacement type. */
      return (await collection.replaceOne(filter, next)).matchedCount === 1;
    },
  };
}
