import type { WorkModelSource } from './models';
import type { WorkConversation } from './task';
import type { WorkGraphAgent } from './graph';
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
      tenantId?: string | null;
      sortBy: string;
      sortDirection: 'asc' | 'desc';
    },
  ): Promise<unknown>;
  getConvo(userId: string, conversationId: string): Promise<unknown>;
};

export type WorkDepsJob = {
  metadata?: {
    userId?: string;
    tenantId?: string | null;
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
  config?: {
    config?: {
      work?: {
        agentGraphLimit?: number;
        agentGraphConcurrency?: number;
      };
    };
  } | null;
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
  /** Agents the request's user can view in its tenant, with model and graph fields. */
  listAgents?: (req: WorkDepsRequest) => Promise<unknown[]>;
  /** The deployment default that automatic routing prefers when it is offered. */
  configuredDefaultModel?: (req: WorkDepsRequest) => Promise<string | null>;
}

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

/** Reads only the fields that decide where a run can go; nothing else leaves the store. */
export function toWorkGraphAgent(row: unknown): WorkGraphAgent | null {
  if (row == null || typeof row !== 'object') {
    return null;
  }
  const agent = row as Record<string, unknown>;
  if (typeof agent.id !== 'string' || !agent.id) {
    return null;
  }
  const subagents =
    agent.subagents != null && typeof agent.subagents === 'object'
      ? (agent.subagents as Record<string, unknown>)
      : null;
  const graphs = Array.isArray(subagents?.graphs)
    ? subagents.graphs.map((graph) => ({
        agent_ids:
          graph != null && typeof graph === 'object' && isStringList(graph.agent_ids)
            ? graph.agent_ids
            : [],
      }))
    : [];
  return {
    id: agent.id,
    ...(typeof agent.name === 'string' ? { name: agent.name } : {}),
    ...(typeof agent.description === 'string' ? { description: agent.description } : {}),
    ...(typeof agent.model === 'string' ? { model: agent.model } : {}),
    ...(typeof agent.provider === 'string' ? { provider: agent.provider } : {}),
    edges: Array.isArray(agent.edges) ? (agent.edges as WorkGraphAgent['edges']) : [],
    agent_ids: isStringList(agent.agent_ids) ? agent.agent_ids : [],
    subagents: {
      enabled: subagents?.enabled === true,
      agent_ids: isStringList(subagents?.agent_ids) ? subagents.agent_ids : [],
      graphs,
    },
  };
}

export function createWorkDepsFactory({
  db,
  jobs,
  loadModels,
  workStateForJobStatus,
  logger,
  projections,
  listAgents,
  configuredDefaultModel,
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
    const workConfig = req.config?.config?.work;
    return {
      listModels: async () => projections.flattenModelConfig(await loadModels(req)),
      ...(listAgents
        ? {
            listAgents: async () =>
              (await listAgents(req))
                .map(toWorkGraphAgent)
                .filter((agent): agent is WorkGraphAgent => agent !== null),
          }
        : {}),
      ...(configuredDefaultModel
        ? { configuredDefaultModel: () => configuredDefaultModel(req) }
        : {}),
      ...(workConfig?.agentGraphLimit != null ? { agentGraphLimit: workConfig.agentGraphLimit } : {}),
      ...(workConfig?.agentGraphConcurrency != null
        ? { agentGraphConcurrency: workConfig.agentGraphConcurrency }
        : {}),
      listConversations: async ({ userId, limit }: { userId: string; limit: number }) => {
        const result = await db.getConvosByCursor(userId, {
          limit,
          isArchived: false,
          isWork: true,
          tenantId: req.user?.tenantId ?? req.tenantId ?? null,
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
      }) => {
        const row = await db.getConvo(userId, conversationId);
        const tenantId = req.user?.tenantId ?? req.tenantId ?? null;
        const rowTenantId =
          row != null && typeof row === 'object' && 'tenantId' in row ? row.tenantId : null;
        if ((rowTenantId ?? null) !== tenantId) {
          return null;
        }
        return projections.toWorkConversation(row);
      },
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
        const tenantId = req.user?.tenantId ?? req.tenantId ?? null;
        if ((job.metadata?.tenantId ?? null) !== tenantId) {
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
        const tenantId = req.user?.tenantId ?? req.tenantId ?? null;
        if ((job.metadata?.tenantId ?? null) !== tenantId) {
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
