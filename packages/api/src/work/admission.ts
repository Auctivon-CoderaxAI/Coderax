import type { WorkModel, WorkModelSource } from './models';
import type { WorkGraphAgent } from './graph';
import {
  buildWorkModelOptions,
  resolveWorkAgentModel,
  WORK_AUTO_MODEL_ID,
} from './models';
import { resolveWorkAgentGraph } from './graph';

type WorkAgentLoader = (
  agentId: string,
) => WorkGraphAgent | null | undefined | Promise<WorkGraphAgent | null | undefined>;

export type WorkAgentAdmission =
  | { ok: true; model: WorkModel }
  | {
      ok: false;
      reason: 'agent_not_found' | 'model_not_allowed' | 'graph_not_allowed' | 'graph_too_large';
    };

export async function admitWorkAgent({
  requestedAgentId,
  sources,
  requestedModel,
  loadAgent,
  canViewAgent,
}: {
  requestedAgentId: string;
  sources: WorkModelSource[];
  requestedModel?: unknown;
  loadAgent: WorkAgentLoader;
  canViewAgent: (agent: WorkGraphAgent) => boolean | Promise<boolean>;
}): Promise<WorkAgentAdmission> {
  const agent = await loadAgent(requestedAgentId);
  if (!agent) {
    return { ok: false, reason: 'agent_not_found' };
  }

  const options = buildWorkModelOptions(sources);
  const model = resolveWorkAgentModel(options, agent);
  if (!model) {
    return { ok: false, reason: 'model_not_allowed' };
  }

  const graph = await resolveWorkAgentGraph(
    { ...agent, id: requestedAgentId },
    options,
    async (agentId) => {
      const member = await loadAgent(agentId);
      return member && (await canViewAgent(member)) ? member : null;
    },
  );
  if (!graph.ok) {
    return {
      ok: false,
      reason: graph.reason === 'too_large' ? 'graph_too_large' : 'graph_not_allowed',
    };
  }

  if (
    requestedModel != null &&
    requestedModel !== '' &&
    requestedModel !== WORK_AUTO_MODEL_ID &&
    requestedModel !== model.id
  ) {
    return { ok: false, reason: 'model_not_allowed' };
  }
  return { ok: true, model };
}
