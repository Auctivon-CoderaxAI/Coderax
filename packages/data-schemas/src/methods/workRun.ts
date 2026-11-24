import type { Model } from 'mongoose';
import type { IWorkRun } from '~/types/workRun';

const DUPLICATE_KEY_ERROR = 11000;

/** Result of a cancellation aimed at one Work task. */
export type WorkRunCancelOutcome =
  /** A live lease was flagged; its owner aborts on the next heartbeat. */
  | 'requested'
  /** The lease had already expired, so the interrupted record was retired. */
  | 'interrupted'
  /** No run is known for this task. */
  | 'none';

export type WorkRunLeaseSnapshot = {
  cancelRequested: boolean;
  expiresAt: Date;
  /** False once the holder stopped heartbeating: the run cannot still be live. */
  live: boolean;
};

export type WorkRunMethods = {
  claimWorkRun: (input: {
    key: string;
    user: string;
    conversationId: string;
    token: string;
    owner: string;
    now: Date;
    expiresAt: Date;
  }) => Promise<boolean>;
  renewWorkRun: (input: {
    key: string;
    token: string;
    now: Date;
    expiresAt: Date;
  }) => Promise<{ renewed: boolean; cancelRequested: boolean }>;
  releaseWorkRun: (input: { key: string; token: string }) => Promise<boolean>;
  cancelWorkRun: (input: { key: string; now: Date }) => Promise<WorkRunCancelOutcome>;
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
   * Takes the lease when no live holder exists. Concurrent claims resolve at the
   * unique key index: the loser's upsert is rejected and it reports itself busy.
   */
  async function claimWorkRun(input: {
    key: string;
    user: string;
    conversationId: string;
    token: string;
    owner: string;
    now: Date;
    expiresAt: Date;
  }): Promise<boolean> {
    try {
      await workRuns().updateOne(
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
        { upsert: true },
      );
      return true;
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        return false;
      }
      throw error;
    }
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
   */
  async function cancelWorkRun(input: { key: string; now: Date }): Promise<WorkRunCancelOutcome> {
    const flagged = await workRuns().findOneAndUpdate(
      { key: input.key, expiresAt: { $gt: input.now } },
      { $set: { cancelRequested: true } },
      { new: true, projection: { _id: 1 } },
    );
    if (flagged != null) {
      return 'requested';
    }
    const retired = await workRuns().deleteOne({
      key: input.key,
      expiresAt: { $lte: input.now },
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
    const result = await workRuns().deleteMany({ _id: { $in: stale.map((row) => row._id) } });
    return result.deletedCount ?? 0;
  }

  return {
    claimWorkRun,
    renewWorkRun,
    releaseWorkRun,
    cancelWorkRun,
    readWorkRun,
    pruneWorkRuns,
  };
}
