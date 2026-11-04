import { randomUUID } from 'node:crypto';

export type SwarmLeaseState = 'claimed' | 'completed' | 'released';

export interface SwarmLease {
  taskId: string;
  leaseId: string;
  peerId: string;
  attempt: number;
  expiresAt: number;
  state: SwarmLeaseState;
  result?: string;
}

export interface SwarmTaskDefinition {
  id: string;
  /** Tools the task needs. Every entry must also be permitted for the peer. */
  requiredTools?: readonly string[];
  /** Task-specific cap; the coordinator's maxAttempts remains the hard ceiling. */
  maxAttempts?: number;
}

export interface SwarmPeer {
  id: string;
  /** Tools this peer advertises. A claim never grants more than this set. */
  tools?: readonly string[];
}

/**
 * Minimal compare-and-swap surface a durable store must implement.
 *
 * `expected` is `null` when the caller observed no lease, or contains the
 * observed lease ID and state. `next` is `null` to delete it. The store must
 * compare both fields and write atomically so terminal transitions cannot
 * overwrite one another or allow duplicate claims.
 */
export interface SwarmLeaseStore {
  get(taskId: string): SwarmLease | null | Promise<SwarmLease | null>;
  compareAndSwap(
    taskId: string,
    expected: Pick<SwarmLease, 'leaseId' | 'state'> | null,
    next: SwarmLease | null,
  ): boolean | Promise<boolean>;
}

export type SwarmClaimFailure =
  | 'invalid_peer'
  | 'invalid_task'
  | 'tool_denied'
  | 'already_completed'
  | 'unavailable'
  | 'attempts_exhausted'
  | 'claim_conflict';

export type SwarmClaimResult =
  | { ok: true; lease: SwarmLease; allowedTools: string[] }
  | { ok: false; reason: SwarmClaimFailure };

export type SwarmCompletionResult =
  | { ok: true; status: 'completed' | 'already_completed' }
  | {
      ok: false;
      reason: 'invalid_peer' | 'invalid_task' | 'result_too_large' | 'lease_lost';
    };

export type SwarmReleaseResult =
  | { ok: true; status: 'released' }
  | { ok: false; reason: 'invalid_peer' | 'invalid_task' | 'lease_lost' };

export interface SwarmCoordinatorOptions {
  store: SwarmLeaseStore;
  /** Hard ceiling for every claim, independent of a peer's advertised tools. */
  allowedTools: readonly string[];
  now?: () => number;
  leaseMs?: number;
  maxAttempts?: number;
  maxResultChars?: number;
  createLeaseId?: () => string;
}

const MAX_IDENTITY_CHARS = 256;
const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_MAX_RESULT_CHARS = 100_000;

function isIdentity(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= MAX_IDENTITY_CHARS
  );
}

/**
 * Consensus-free lease arbitration for a decentralized agent swarm.
 *
 * Peers race through one compare-and-swap key per task, so there is no elected
 * leader and no shared in-process queue. A live lease blocks duplicate claims;
 * an expired lease is reclaimable with an incremented attempt, which is how a
 * failed peer's work is recovered. The coordinator never enables itself: a
 * runtime must construct it explicitly, so it cannot change normal Chat.
 */
export class SwarmCoordinator {
  private readonly store: SwarmLeaseStore;
  private readonly ceiling: ReadonlySet<string>;
  private readonly now: () => number;
  private readonly leaseMs: number;
  private readonly maxAttempts: number;
  private readonly maxResultChars: number;
  private readonly createLeaseId: () => string;

  constructor(options: SwarmCoordinatorOptions) {
    if (!options || !options.store) {
      throw new Error('SwarmCoordinator requires a lease store');
    }
    const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
    const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const maxResultChars = options.maxResultChars ?? DEFAULT_MAX_RESULT_CHARS;
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1) {
      throw new Error('SwarmCoordinator leaseMs must be a positive integer');
    }
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
      throw new Error('SwarmCoordinator maxAttempts must be a positive integer');
    }
    if (!Number.isSafeInteger(maxResultChars) || maxResultChars < 1) {
      throw new Error('SwarmCoordinator maxResultChars must be a positive integer');
    }
    this.store = options.store;
    this.ceiling = new Set(options.allowedTools ?? []);
    this.now = options.now ?? Date.now;
    this.leaseMs = leaseMs;
    this.maxAttempts = maxAttempts;
    this.maxResultChars = maxResultChars;
    this.createLeaseId = options.createLeaseId ?? randomUUID;
  }

  async claim(peer: SwarmPeer, task: SwarmTaskDefinition): Promise<SwarmClaimResult> {
    if (!isIdentity(peer?.id)) {
      return { ok: false, reason: 'invalid_peer' };
    }
    if (!isIdentity(task?.id)) {
      return { ok: false, reason: 'invalid_task' };
    }
    const taskLimit = task.maxAttempts ?? this.maxAttempts;
    if (!Number.isSafeInteger(taskLimit) || taskLimit < 1) {
      return { ok: false, reason: 'invalid_task' };
    }

    const peerTools = new Set(peer.tools ?? []);
    if (
      (task.requiredTools ?? []).some(
        (tool) => !this.ceiling.has(tool) || !peerTools.has(tool),
      )
    ) {
      return { ok: false, reason: 'tool_denied' };
    }

    const current = await this.store.get(task.id);
    if (current?.state === 'completed') {
      return { ok: false, reason: 'already_completed' };
    }
    const now = this.now();
    if (current?.state === 'claimed' && current.expiresAt > now) {
      return { ok: false, reason: 'unavailable' };
    }

    const attempt = (current?.attempt ?? 0) + 1;
    if (attempt > Math.min(taskLimit, this.maxAttempts)) {
      return { ok: false, reason: 'attempts_exhausted' };
    }

    const lease: SwarmLease = {
      taskId: task.id,
      leaseId: this.createLeaseId(),
      peerId: peer.id,
      attempt,
      expiresAt: now + this.leaseMs,
      state: 'claimed',
    };
    const expected = current
      ? { leaseId: current.leaseId, state: current.state }
      : null;
    if (!(await this.store.compareAndSwap(task.id, expected, lease))) {
      return { ok: false, reason: 'claim_conflict' };
    }

    return {
      ok: true,
      lease,
      allowedTools: [...this.ceiling].filter((tool) => peerTools.has(tool)),
    };
  }

  async complete(
    peer: SwarmPeer,
    taskId: string,
    leaseId: string,
    result: string,
  ): Promise<SwarmCompletionResult> {
    if (!isIdentity(peer?.id)) {
      return { ok: false, reason: 'invalid_peer' };
    }
    if (!isIdentity(taskId)) {
      return { ok: false, reason: 'invalid_task' };
    }
    if (typeof result !== 'string' || result.length > this.maxResultChars) {
      return { ok: false, reason: 'result_too_large' };
    }

    const current = await this.store.get(taskId);
    if (current?.state === 'completed') {
      return current.peerId === peer.id && current.leaseId === leaseId
        ? { ok: true, status: 'already_completed' }
        : { ok: false, reason: 'lease_lost' };
    }
    if (
      !current ||
      current.state !== 'claimed' ||
      current.peerId !== peer.id ||
      current.leaseId !== leaseId ||
      current.expiresAt <= this.now()
    ) {
      return { ok: false, reason: 'lease_lost' };
    }

    const completed: SwarmLease = {
      ...current,
      state: 'completed',
      result,
    };
    return (await this.store.compareAndSwap(taskId, { leaseId, state: 'claimed' }, completed))
      ? { ok: true, status: 'completed' }
      : { ok: false, reason: 'lease_lost' };
  }

  async release(
    peer: SwarmPeer,
    taskId: string,
    leaseId: string,
  ): Promise<SwarmReleaseResult> {
    if (!isIdentity(peer?.id)) {
      return { ok: false, reason: 'invalid_peer' };
    }
    if (!isIdentity(taskId)) {
      return { ok: false, reason: 'invalid_task' };
    }

    const current = await this.store.get(taskId);
    if (
      !current ||
      current.state !== 'claimed' ||
      current.peerId !== peer.id ||
      current.leaseId !== leaseId ||
      current.expiresAt <= this.now()
    ) {
      return { ok: false, reason: 'lease_lost' };
    }

    const released: SwarmLease = {
      taskId: current.taskId,
      leaseId: current.leaseId,
      peerId: current.peerId,
      attempt: current.attempt,
      expiresAt: current.expiresAt,
      state: 'released',
    };
    return (await this.store.compareAndSwap(taskId, { leaseId, state: 'claimed' }, released))
      ? { ok: true, status: 'released' }
      : { ok: false, reason: 'lease_lost' };
  }
}

/**
 * Single-process CAS store for tests and local development. A durable runtime
 * supplies the same interface from its database with an atomic conditional
 * write; this implementation is not a cross-replica coordinator.
 */
export function createMemorySwarmStore(
  initial: readonly SwarmLease[] = [],
): SwarmLeaseStore {
  const leases = new Map(initial.map((lease) => [lease.taskId, { ...lease }]));
  return {
    get(taskId) {
      const lease = leases.get(taskId);
      return lease ? { ...lease } : null;
    },
    compareAndSwap(taskId, expected, next) {
      const current = leases.get(taskId) ?? null;
      if (
        (current?.leaseId ?? null) !== (expected?.leaseId ?? null) ||
        (current?.state ?? null) !== (expected?.state ?? null)
      ) {
        return false;
      }
      if (next == null) {
        leases.delete(taskId);
      } else {
        leases.set(taskId, { ...next });
      }
      return true;
    },
  };
}
