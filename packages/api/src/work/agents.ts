import { DEFAULT_WORK_AGENT_GRAPH_CONCURRENCY } from 'coderax-data-provider';
import type { WorkAgentMember, WorkGraphAgent } from './graph';
import type { WorkModel } from './models';
import { resolveWorkAgentGraph } from './graph';

export type WorkAgentPageInput<Id> = {
  accessibleIds: Id[] | null;
  tenantId: string | null;
  limit: number;
  includeExecutionConfig: true;
  includeModelConfig: true;
  after?: string;
};

export type WorkAgentPage<Agent> = {
  data: Agent[];
  has_more: boolean;
  after: string | null;
};

export function createWorkAgentPageLoader<Id, Agent>(
  loadPage: (input: WorkAgentPageInput<Id>) => Promise<WorkAgentPage<Agent>>,
): (input: Omit<WorkAgentPageInput<Id>, 'after'>) => Promise<Agent[]> {
  return async function loadAll(input: Omit<WorkAgentPageInput<Id>, 'after'>): Promise<Agent[]> {
    const data: Agent[] = [];
    let after: string | undefined;
    const seenCursors = new Set<string>();

    while (true) {
      const page = await loadPage({
        ...input,
        ...(after ? { after } : {}),
      });
      data.push(...page.data);
      if (!page.has_more) {
        return data;
      }
      if (!page.after || seenCursors.has(page.after)) {
        throw new Error('Work agent pagination did not advance');
      }
      seenCursors.add(page.after);
      after = page.after;
    }
  };
}

export type WorkAgentOption = {
  id: string;
  name?: string;
  description?: string;
  model: string;
  provider: string;
  members: WorkAgentMember[];
};

export async function listEligibleWorkAgents(input: {
  agents: WorkGraphAgent[];
  models: WorkModel[];
  loadAgent?: (agentId: string) => Promise<WorkGraphAgent | null | undefined>;
  graphLimit: number;
  concurrency: number;
}): Promise<WorkAgentOption[]> {
  const { agents, models, graphLimit } = input;
  const byId = new Map<string, WorkGraphAgent>();
  for (const agent of agents) {
    if (typeof agent.id === 'string') {
      byId.set(agent.id, agent);
    }
  }
  const loadAgent = input.loadAgent ?? (async (id: string) => byId.get(id));
  const eligible: Array<WorkAgentOption | null> = Array.from({ length: agents.length }, () => null);
  const requestedConcurrency =
    Number.isSafeInteger(input.concurrency) && input.concurrency > 0
      ? input.concurrency
      : DEFAULT_WORK_AGENT_GRAPH_CONCURRENCY;
  let nextIndex = 0;

  const checkNextAgent = async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= agents.length) {
        return;
      }
      const agent = agents[index];
      if (typeof agent.id !== 'string' || !agent.id) {
        continue;
      }
      const graph = await resolveWorkAgentGraph(agent, models, loadAgent, graphLimit);
      if (!graph.ok) {
        continue;
      }
      eligible[index] = {
        id: agent.id,
        ...(agent.name ? { name: agent.name } : {}),
        ...(agent.description ? { description: agent.description } : {}),
        model: graph.model.id,
        provider: graph.model.provider ?? '',
        members: graph.members,
      };
    }
  };

  const workerCount = Math.min(agents.length, requestedConcurrency);
  await Promise.all(Array.from({ length: workerCount }, () => checkNextAgent()));
  return eligible.filter((agent): agent is WorkAgentOption => agent !== null);
}
