import type { Collection } from 'mongodb';

/**
 * Persistence projection of a decentralized swarm lease. It mirrors the
 * coordinator's domain lease but is declared here so this package never
 * depends on `packages/api`.
 */
export type SwarmLeaseState = 'claimed' | 'completed' | 'released';

export interface SwarmLeaseRecord {
  taskId: string;
  leaseId: string;
  peerId: string;
  attempt: number;
  expiresAt: number;
  state: SwarmLeaseState;
  result?: string;
}

export type SwarmLeaseDocument = SwarmLeaseRecord & { _id: string };

export type SwarmLeaseCollection = Pick<
  Collection<SwarmLeaseDocument>,
  'findOne' | 'insertOne' | 'replaceOne' | 'deleteOne'
>;

export interface SwarmLeaseExpectation {
  leaseId: string;
  state: SwarmLeaseState;
}

/**
 * Storage-only contract for durable swarm leases.
 *
 * The coordinator owns lease semantics. This layer owns atomicity: a
 * replacement or deletion succeeds only when the caller supplies the exact
 * lease ID and state it observed, so a delayed peer cannot overwrite a lease
 * that has already been reassigned.
 */
export interface SwarmLeaseRepository {
  read(key: string): Promise<SwarmLeaseRecord | null>;
  insert(key: string, lease: SwarmLeaseRecord): Promise<boolean>;
  replace(key: string, expected: SwarmLeaseExpectation, next: SwarmLeaseRecord): Promise<boolean>;
  remove(key: string, expected: SwarmLeaseExpectation): Promise<boolean>;
}

function isDuplicateKey(error: unknown): boolean {
  return error != null && typeof error === 'object' && 'code' in error && error.code === 11000;
}

/**
 * Atomic compare-and-swap over Mongo's unique `_id` index.
 *
 * A missing key is created only through `insertOne`, so a duplicate-key error
 * is a lost race rather than a write. An existing key is replaced or deleted
 * only when both lease ID and state match. No upsert can overwrite an existing
 * lease, and a full replacement clears fields left by an earlier attempt.
 */
export function createSwarmLeaseRepository(collection: SwarmLeaseCollection): SwarmLeaseRepository {
  if (!collection) {
    throw new TypeError('Swarm lease repository requires a Mongo collection');
  }

  return {
    async read(key) {
      const row = await collection.findOne({ _id: key });
      if (!row) {
        return null;
      }
      const { _id: _key, ...lease } = row;
      return lease;
    },

    async insert(key, lease) {
      try {
        await collection.insertOne({ _id: key, ...lease });
        return true;
      } catch (error) {
        if (isDuplicateKey(error)) {
          return false;
        }
        throw error;
      }
    },

    async replace(key, expected, next) {
      const result = await collection.replaceOne(
        { _id: key, leaseId: expected.leaseId, state: expected.state },
        next,
      );
      return result.matchedCount === 1;
    },

    async remove(key, expected) {
      const result = await collection.deleteOne({
        _id: key,
        leaseId: expected.leaseId,
        state: expected.state,
      });
      return result.deletedCount === 1;
    },
  };
}
