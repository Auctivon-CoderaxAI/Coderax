import type { SwarmLeaseRepository } from '@coderax/data-schemas';
import type { SwarmLeaseStore } from './swarm';

/**
 * Durable swarm leases keyed by the authenticated owner, tenant, run and task.
 * The caller MUST populate scope from trusted request/run identity, never from
 * an unverified A2A payload. This adapter does not authorize agent/tool access;
 * the coordinator and its caller remain responsible for those checks.
 *
 * Persistence lives in `packages/data-schemas`; this module only derives the
 * scoped key and maps the coordinator's compare-and-swap contract onto it.
 */
export interface MongoSwarmScope {
  userId: string;
  tenantId: string | null;
  runId: string;
}

function checkScope(scope: MongoSwarmScope): void {
  if (
    !scope ||
    typeof scope.userId !== 'string' ||
    (scope.userId.trim().length === 0 || scope.userId.length > 120) ||
    typeof scope.runId !== 'string' ||
    (scope.runId.trim().length === 0 || scope.runId.length > 120) ||
    (scope.tenantId !== null &&
      (typeof scope.tenantId !== 'string' ||
        scope.tenantId.trim().length === 0 ||
        scope.tenantId.length > 120))
  ) {
    throw new TypeError('Mongo swarm store requires an authenticated owner, run and tenant scope');
  }
}

/**
 * Cross-process lease store for one authenticated scope.
 *
 * The repository guarantees that a missing key is created only once and that
 * an existing key changes only when both lease ID and state match, fencing
 * delayed completions and releases from earlier attempts. Unlike the in-memory
 * test adapter, this store can survive process restarts. It is still NOT wired
 * into Chat/Work runtime; production use requires an explicit feature gate, a
 * collection with acknowledged writes, and real multi-worker certification.
 */
export function createMongoSwarmStore(
  repository: SwarmLeaseRepository,
  scope: MongoSwarmScope,
): SwarmLeaseStore {
  if (!repository) {
    throw new TypeError('Mongo swarm store requires a lease repository');
  }
  checkScope(scope);
  const namespace = [scope.userId, scope.tenantId, scope.runId] as const;
  const keyFor = (taskId: string): string => JSON.stringify([...namespace, taskId]);

  return {
    async get(taskId) {
      return repository.read(keyFor(taskId));
    },

    async compareAndSwap(taskId, expected, next) {
      if (next != null && next.taskId !== taskId) {
        throw new TypeError('Swarm lease task ID does not match compare-and-swap key');
      }
      const key = keyFor(taskId);
      if (expected == null) {
        if (next == null) {
          return false;
        }
        return repository.insert(key, next);
      }
      if (next == null) {
        return repository.remove(key, expected);
      }
      return repository.replace(key, expected, next);
    },
  };
}
