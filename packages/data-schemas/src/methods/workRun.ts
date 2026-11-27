import type { Model } from 'mongoose';
import type { IWorkRun } from '~/types/workRun';
import { createIndexesWithRetry } from '~/utils/retry';

const DUPLICATE_KEY_ERROR = 11000;
const NAMESPACE_EXISTS = 48;
const KEY_INDEX = 'key_1';

/** Result of a cancellation aimed at one Work task. */
export type WorkRunCancelOutcome =
  /** A live lease was flagged; its owner aborts on the next heartbeat. */
  | 'requested'
  /** The lease had already expired, so the interrupted record was retired. */
  | 'interrupted'
  /** No run is known for this task. */
  | 'none';

export type WorkRunLeaseSnapshot = {
  /** The holder's fencing token: the generation a conversation write is bound to. */
  token: string;
  cancelRequested: boolean;
  expiresAt: Date;
  /** False once the holder stopped heartbeating: the run cannot still be live. */
  live: boolean;
};

export type WorkRunClaimInput = {
  key: string;
  user: string;
  conversationId: string;
  token: string;
  owner: string;
  now: Date;
  expiresAt: Date;
};

/** A claim and the expired generation it replaced, read in one operation. */
export type WorkRunClaimResult = {
  claimed: boolean;
  previousToken: string | null;
};

export type WorkRunMethods = {
  claimWorkRun: (input: WorkRunClaimInput) => Promise<boolean>;
  claimWorkRunLease: (input: WorkRunClaimInput) => Promise<WorkRunClaimResult>;
  renewWorkRun: (input: {
    key: string;
    token: string;
    now: Date;
    expiresAt: Date;
  }) => Promise<{ renewed: boolean; cancelRequested: boolean }>;
  releaseWorkRun: (input: { key: string; token: string }) => Promise<boolean>;
  /** With `token`, only the generation the caller observed is flagged or retired. */
  cancelWorkRun: (input: {
    key: string;
    now: Date;
    token?: string;
  }) => Promise<WorkRunCancelOutcome>;
  readWorkRun: (input: { key: string; now: Date }) => Promise<WorkRunLeaseSnapshot | null>;
  pruneWorkRuns: (input: { before: Date; limit: number }) => Promise<number>;
};

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: number }).code === DUPLICATE_KEY_ERROR
  );
}

/**
 * Work engine run leases, shared by every API replica.
 *
 * A run holds its lease for as long as it heartbeats. A restart or a crashed
 * replica stops renewing, so the lease expires and the next claim takes over;
 * state reads report the expired run as failed instead of leaving the task
 * "running" forever. Cancellation is a durable flag because the request may
 * land on a different replica than the one executing the run.
 */
export function createWorkRunMethods(mongoose: typeof import('mongoose')): WorkRunMethods {
  function workRuns(): Model<IWorkRun> {
    return mongoose.models.WorkRun as Model<IWorkRun>;
  }

  /**
   * Concurrent claims only resolve safely at the unique key index. Build it
   * before the first claim instead of trusting automatic index creation, which
   * is disabled in some deployments; the result is memoized and retried.
   */
  let indexesReady: Promise<void> | null = null;
  function ensureWorkRunIndexes(): Promise<void> {
    if (!indexesReady) {
      indexesReady = (async () => {
        const model = workRuns();
        await model.createCollection().catch((error: unknown) => {
          if ((error as { code?: number }).code !== NAMESPACE_EXISTS) {
            throw error;
          }
        });
        const keyIndex = (await model.listIndexes()).find((index) => index.name === KEY_INDEX);
        if (keyIndex?.unique !== true || keyIndex.key?.key !== 1) {
          await createIndexesWithRetry(model);
        }
        const verified = (await model.listIndexes()).find((index) => index.name === KEY_INDEX);
        if (verified?.unique !== true) {
          throw new Error('The Work run lease key index is not unique.');
        }
      })().catch((error) => {
        indexesReady = null;
        throw error;
      });
    }
    return indexesReady;
  }

  /**
   * Takes the lease when no live holder exists and reports the generation it
   * replaced. Concurrent claims resolve at the unique key index: the loser's
   * upsert is rejected and it reports itself busy.
   */
  async function claimWorkRunLease(input: WorkRunClaimInput): Promise<WorkRunClaimResult> {
    await ensureWorkRunIndexes();
    try {
      const previous = await workRuns()
        .findOneAndUpdate(
          { key: input.key, expiresAt: { $lte: input.now } },
          {
            $set: {
              user: input.user,
              conversationId: input.conversationId,
              token: input.token,
              owner: input.owner,
              cancelRequested: false,
              expiresAt: input.expiresAt,
            },
            $setOnInsert: { key: input.key },
          },
          {
            upsert: true,
            new: false,
            projection: { token: 1, _id: 0 },
          },
        )
        .lean<Pick<IWorkRun, 'token'> | null>();
      return { claimed: true, previousToken: previous?.token ?? null };
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        return { claimed: false, previousToken: null };
      }
      throw error;
    }
  }

  async function claimWorkRun(input: WorkRunClaimInput): Promise<boolean> {
    return (await claimWorkRunLease(input)).claimed;
  }

  /** Renews only an unexpired lease held by this exact token. */
  async function renewWorkRun(input: {
    key: string;
    token: string;
    now: Date;
    expiresAt: Date;
  }): Promise<{ renewed: boolean; cancelRequested: boolean }> {
    const renewed = await workRuns()
      .findOneAndUpdate(
        { key: input.key, token: input.token, expiresAt: { $gt: input.now } },
        { $set: { expiresAt: input.expiresAt } },
        { new: true, projection: { cancelRequested: 1, _id: 0 } },
      )
      .lean<Pick<IWorkRun, 'cancelRequested'> | null>();
    return {
      renewed: renewed != null,
      cancelRequested: renewed?.cancelRequested === true,
    };
  }

  /** Releases only the lease owned by this exact token. */
  async function releaseWorkRun(input: { key: string; token: string }): Promise<boolean> {
    const result = await workRuns().deleteOne({ key: input.key, token: input.token });
    return result.deletedCount === 1;
  }

  /**
   * Flags a live lease so its owner aborts on the next heartbeat. An expired
   * lease has no owner left to observe the flag, so it is retired here and the
   * caller learns that the run was interrupted rather than cancelled live.
   * With `token`, both steps address only the generation the caller observed,
   * so a cancellation cannot flag or retire a replacement run.
   */
  async function cancelWorkRun(input: {
    key: string;
    now: Date;
    token?: string;
  }): Promise<WorkRunCancelOutcome> {
    const generation = input.token == null ? {} : { token: input.token };
    const flagged = await workRuns().findOneAndUpdate(
      { key: input.key, expiresAt: { $gt: input.now }, ...generation },
      { $set: { cancelRequested: true } },
      { new: true, projection: { _id: 1 } },
    );
    if (flagged != null) {
      return 'requested';
    }
    const retired = await workRuns().deleteOne({
      key: input.key,
      expiresAt: { $lte: input.now },
      ...generation,
    });
    return retired.deletedCount === 1 ? 'interrupted' : 'none';
  }

  /** Reads the durable run for a task; an expired lease reports `live: false`. */
  async function readWorkRun(input: {
    key: string;
    now: Date;
  }): Promise<WorkRunLeaseSnapshot | null> {
    const row = await workRuns().findOne({ key: input.key }).lean<IWorkRun | null>();
    if (row == null) {
      return null;
    }
    return {
      token: row.token,
      cancelRequested: row.cancelRequested === true,
      expiresAt: row.expiresAt,
      live: row.expiresAt.getTime() > input.now.getTime(),
    };
  }

  /**
   * Deletes at most `limit` rows whose lease expired before `before`, oldest
   * first. Takeover, cancellation and state reads all address rows by key, so a
   * dead process's row is only reclaimable once its retention window is over.
   */
  async function pruneWorkRuns(input: { before: Date; limit: number }): Promise<number> {
    const limit = Math.max(0, Math.floor(input.limit));
    if (limit === 0) {
      return 0;
    }
    const stale = await workRuns()
      .find({ expiresAt: { $lte: input.before } }, { _id: 1 })
      .sort({ expiresAt: 1 })
      .limit(limit)
      .lean();
    if (stale.length === 0) {
      return 0;
    }
    /** Re-check the expiry: a row reclaimed after the select must survive. */
    const result = await workRuns().deleteMany({
      _id: { $in: stale.map((row) => row._id) },
      expiresAt: { $lte: input.before },
    });
    return result.deletedCount ?? 0;
  }

  return {
    claimWorkRun,
    claimWorkRunLease,
    renewWorkRun,
    releaseWorkRun,
    cancelWorkRun,
    readWorkRun,
    pruneWorkRuns,
  };
}
