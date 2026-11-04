import type { WorkModelSource } from './models';
import type { WorkConversation } from './task';
import type { WorkDeps } from './router';

/**
 * Request-scoped dependencies for the native Work read/cancel router.
 *
 * The database, job manager and pure projections are injected so owner and
 * tenant cancellation checks can be tested without Mongo or the generation
 * runtime. The CJS route module is wiring only.
 */
export type WorkDepsStore = {
  getConvosByCursor(
    userId: string,
    options: {
      limit: number;
      isArchived: boolean;
      isWork?: true;
      sortBy: string;
      sortDirection: 'asc' | 'desc';
    },
  ): Promise<unknown>;
  getConvo(userId: string, conversationId: string): Promise<unknown>;
};

export type WorkDepsJob = {
  metadata?: {
    userId?: string;
    tenantId?: string;
  };
  createdAt?: unknown;
};

export type WorkDepsJobs = {
  getJob(conversationId: string): Promise<WorkDepsJob | null | undefined>;
  getJobStatus(conversationId: string): Promise<string | null | undefined>;
  abortJob(
    conversationId: string,
    options: { expectedCreatedAt?: unknown },
  ): Promise<{ success?: boolean } | null | undefined>;
};

export type WorkDepsRequest = {
  user?: { id?: string; tenantId?: string };
  tenantId?: string;
};

export type WorkDepsLogger = {
  warn?: (message: string) => void;
};

export type WorkDepsProjections = {
  flattenModelConfig: (config: unknown) => WorkModelSource[];
  toWorkConversation: (row: unknown) => WorkConversation | null;
  rowsFromCursor: (result: unknown) => unknown[];
  onlyWorkRows: (rows: readonly (WorkConversation | null)[]) => WorkConversation[];
};

export interface WorkDepsFactoryOptions {
  db: WorkDepsStore;
  jobs: WorkDepsJobs;
  loadModels: (req: WorkDepsRequest) => Promise<unknown> | unknown;
  workStateForJobStatus: (status: string | null | undefined) => string | null;
  logger?: WorkDepsLogger;
  projections: WorkDepsProjections;
}

export function createWorkDepsFactory({
  db,
  jobs,
  loadModels,
  workStateForJobStatus,
  logger,
  projections,
}: WorkDepsFactoryOptions): (req: WorkDepsRequest) => WorkDeps {
  if (
    !db ||
    !jobs ||
    typeof loadModels !== 'function' ||
    typeof workStateForJobStatus !== 'function' ||
    !projections ||
    typeof projections.flattenModelConfig !== 'function' ||
    typeof projections.toWorkConversation !== 'function' ||
    typeof projections.rowsFromCursor !== 'function' ||
    typeof projections.onlyWorkRows !== 'function'
  ) {
    throw new TypeError(
      'createWorkDepsFactory requires db, jobs, loadModels, workStateForJobStatus and projections',
    );
  }

  return function depsFor(req: WorkDepsRequest): WorkDeps {
    return {
      listModels: async () => projections.flattenModelConfig(await loadModels(req)),
      listConversations: async ({ userId, limit }: { userId: string; limit: number }) => {
        const result = await db.getConvosByCursor(userId, {
          limit,
          isArchived: false,
          isWork: true,
          sortBy: 'updatedAt',
          sortDirection: 'desc',
        });
        return projections.onlyWorkRows(
          projections.rowsFromCursor(result).map(projections.toWorkConversation),
        );
      },
      getConversation: async ({
        userId,
        conversationId,
      }: {
        userId: string;
        conversationId: string;
      }) => projections.toWorkConversation(await db.getConvo(userId, conversationId)),
      getRunState: async ({
        userId,
        conversationId,
      }: {
        userId: string;
        conversationId: string;
      }) => {
        const job = await jobs.getJob(conversationId);
        if (!job || job.metadata?.userId !== userId) {
          return null;
        }
        const tenantId = req.user?.tenantId ?? req.tenantId;
        if (tenantId && job.metadata?.tenantId !== tenantId) {
          return null;
        }
        return workStateForJobStatus(await jobs.getJobStatus(conversationId));
      },
      cancelRun: async ({ userId, conversationId }: { userId: string; conversationId: string }) => {
        const job = await jobs.getJob(conversationId);
        if (!job) {
          return false;
        }
        /**
         * The router already scoped the conversation to this user; this second
         * check uses the job's own owner so a stale or foreign job can never be
         * aborted through a Work request.
         */
        if (job.metadata?.userId !== userId) {
          logger?.warn?.(`[Work] Refusing to abort another user's generation: ${conversationId}`);
          return false;
        }
        const tenantId = req.user?.tenantId ?? req.tenantId;
        if (job.metadata?.tenantId !== tenantId) {
          logger?.warn?.(`[Work] Refusing to abort another tenant's generation: ${conversationId}`);
          return false;
        }
        const result = await jobs.abortJob(conversationId, {
          expectedCreatedAt: job.createdAt,
        });
        return result?.success === true;
      },
    };
  };
}
