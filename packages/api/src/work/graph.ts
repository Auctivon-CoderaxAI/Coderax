import {
  DEFAULT_WORK_AGENT_GRAPH_CONCURRENCY,
  DEFAULT_WORK_AGENT_GRAPH_LIMIT,
} from 'coderax-data-provider';
import type { GraphEdge } from 'coderax-data-provider';
import type { WorkModel } from './models';
import { collectEdgeAgentIds } from '../agents/edges';
import { resolveWorkAgentModel } from './models';

/**
 * A saved agent as Work needs to see it: what it runs on, and every route by
 * which one run can hand work to another agent.
 */
export type WorkGraphAgent = {
  id?: string;
  name?: string;
  description?: string;
  model?: string;
  provider?: string;
  edges?: GraphEdge[] | null;
  /** Legacy sequential chain. */
  agent_ids?: string[] | null;
  subagents?: {
    /** Disabled subagents are not prepared by the native initializer. */
    enabled?: boolean | null;
    agent_ids?: string[] | null;
    graphs?: Array<{ agent_ids?: string[] | null } | null> | null;
  } | null;
};

export type WorkAgentMember = {
  id: string;
  name?: string;
  model: string;
  provider: string;
};

export type WorkAgentGraphFailure = 'model_not_allowed' | 'member_model_not_allowed' | 'too_large';

export type WorkAgentGraph =
  | { ok: true; model: WorkModel; members: WorkAgentMember[] }
  | { ok: false; reason: WorkAgentGraphFailure; agentId?: string };

export { DEFAULT_WORK_AGENT_GRAPH_LIMIT };

/** Every agent one saved agent can hand work to directly, whatever the route. */
export function workAgentReferences(agent: WorkGraphAgent): string[] {
  const ids = new Set<string>(collectEdgeAgentIds(agent.edges ?? undefined));
  for (const id of agent.agent_ids ?? []) {
    ids.add(id);
  }
  /** Saved disabled children must not affect Work admission: native execution
   * skips them until subagents are explicitly enabled. */
  if (agent.subagents?.enabled === true) {
    for (const id of agent.subagents.agent_ids ?? []) {
      ids.add(id);
    }
    for (const graph of agent.subagents.graphs ?? []) {
      for (const id of graph?.agent_ids ?? []) {
        ids.add(id);
      }
    }
  }
  if (agent.id) {
    ids.delete(agent.id);
  }
  return [...ids].filter((id) => typeof id === 'string' && id.length > 0);
}

/**
 * Walk everything one Work run can reach from `root` and decide whether all of
 * it runs on an offered free/local model.
 *
 * `loadAgent` returns only agents the caller may view. The native runtime skips
 * an agent the caller cannot view or that no longer exists, so such a reference
 * can never execute and neither blocks nor appears as a member. Any agent that
 * can execute must match a Work model by id and provider; one that does not
 * makes the whole graph ineligible rather than being dropped silently.
 */
export async function resolveWorkAgentGraph(
  root: WorkGraphAgent,
  models: WorkModel[],
  loadAgent: (agentId: string) => Promise<WorkGraphAgent | null | undefined>,
  limit: number = DEFAULT_WORK_AGENT_GRAPH_LIMIT,
  concurrency: number = DEFAULT_WORK_AGENT_GRAPH_CONCURRENCY,
): Promise<WorkAgentGraph> {
  const rootModel = resolveWorkAgentModel(models, root);
  if (!rootModel) {
    return { ok: false, reason: 'model_not_allowed', agentId: root.id };
  }
  const visited = new Set<string>(root.id ? [root.id] : []);
  const members: WorkAgentMember[] = [];
  let frontier = workAgentReferences(root);
  const batchSize =
    Number.isSafeInteger(concurrency) && concurrency > 0
      ? concurrency
      : DEFAULT_WORK_AGENT_GRAPH_CONCURRENCY;
  while (frontier.length > 0) {
    const next: string[] = [];
    for (let offset = 0; offset < frontier.length; offset += batchSize) {
      const batchIds: string[] = [];
      for (const agentId of frontier.slice(offset, offset + batchSize)) {
        if (visited.has(agentId)) {
          continue;
        }
        visited.add(agentId);
        if (visited.size > limit) {
          return { ok: false, reason: 'too_large' };
        }
        batchIds.push(agentId);
      }
      // Siblings are independent. Bound their ACL/database reads, while keeping
      // results in reference order and checking every executable model.
      const loaded = await Promise.all(batchIds.map((agentId) => loadAgent(agentId)));
      for (let index = 0; index < batchIds.length; index++) {
        const agentId = batchIds[index];
        const agent = loaded[index];
        if (!agent) {
          continue;
        }
        const model = resolveWorkAgentModel(models, { ...agent, id: agentId });
        if (!model) {
          return { ok: false, reason: 'member_model_not_allowed', agentId };
        }
        members.push({
          id: agentId,
          ...(agent.name ? { name: agent.name } : {}),
          model: model.id,
          provider: model.provider ?? '',
        });
        next.push(...workAgentReferences({ ...agent, id: agentId }));
      }
    }
    frontier = next;
  }
  return { ok: true, model: rootModel, members };
}

/**
 * One agent config the native initializer prepared for a run. Full configs keep
 * the provider the agent was saved with in `endpoint` (their `provider` may be
 * rewritten to a client family); lazy descriptors carry the saved one directly.
 */
export type WorkRunConfig = {
  id?: string;
  model?: string;
  provider?: string;
  endpoint?: string;
  subagentAgentConfigs?: WorkRunConfig[] | null;
  lazySubagentConfigs?: WorkRunConfig[] | null;
  subagentGraphConfigs?: Array<{ memberConfigs?: WorkRunConfig[] | null } | null> | null;
  subagentGraphMemberMetadata?: WorkRunConfig[] | null;
};

export type WorkRunTarget = { id?: string; model?: string; provider?: string };

/** Every agent config the prepared run can execute, nested subagents included. */
export function collectWorkRunTargets(
  roots: Array<WorkRunConfig | null | undefined>,
): WorkRunTarget[] {
  const seen = new Set<WorkRunConfig>();
  const targets: WorkRunTarget[] = [];
  const stack = roots.filter((config): config is WorkRunConfig => config != null);
  while (stack.length > 0) {
    const config = stack.pop() as WorkRunConfig;
    if (seen.has(config)) {
      continue;
    }
    seen.add(config);
    targets.push({
      id: config.id,
      model: config.model,
      provider: config.endpoint ?? config.provider,
    });
    stack.push(
      ...(config.subagentAgentConfigs ?? []),
      ...(config.lazySubagentConfigs ?? []),
      ...(config.subagentGraphMemberMetadata ?? []),
      ...(config.subagentGraphConfigs ?? []).flatMap((graph) => graph?.memberConfigs ?? []),
    );
  }
  return targets;
}

/** The concrete free/local models a Work request was admitted against. */
export type WorkRunAllowance = Array<{ id: string; provider?: string }>;

/**
 * The authoritative Work check, run on the configs the initializer actually
 * prepared and before any model is called. It covers what the request
 * middleware cannot see: handoff and chain targets, an added conversation,
 * spec-attached subagents, and agents edited after admission.
 *
 * @returns The first target outside the allowance, or null when the run may start.
 */
export function findWorkRunViolation(
  allowance: WorkRunAllowance | null | undefined,
  roots: Array<WorkRunConfig | null | undefined>,
): WorkRunTarget | null {
  const allowed = new Set(
    (allowance ?? []).map((model) => `${model.provider ?? ''}\u0000${model.id}`),
  );
  for (const target of collectWorkRunTargets(roots)) {
    if (!target.model || !allowed.has(`${target.provider ?? ''}\u0000${target.model}`)) {
      return target;
    }
  }
  return null;
}

export function enforceWorkRunAllowance(
  context: { isWork?: boolean; allowedModels?: WorkRunAllowance | null } | null | undefined,
  roots: Array<WorkRunConfig | null | undefined>,
  errorType: string,
  reportViolation: (target: WorkRunTarget) => void,
): void {
  if (!context?.isWork) {
    return;
  }
  const violation = findWorkRunViolation(context.allowedModels, roots);
  if (!violation) {
    return;
  }
  reportViolation(violation);
  throw new Error(`{ "type": "${errorType}" }`);
}
