import type { WorkAgentGraph, WorkGraphAgent } from './graph';
import type { WorkModelSource } from './models';
import type { WorkModel } from './models';
import {
  buildWorkModelOptions,
  resolveWorkAgentModel,
  resolveWorkSelection,
  workConcreteModels,
  WORK_AUTO_MODEL_ID,
} from './models';
import { DEFAULT_WORK_AGENT_GRAPH_LIMIT, resolveWorkAgentGraph } from './graph';
import { isValidWorkId } from './ids';

type WorkModelContext = {
  isWork: true;
  workModel: string;
  workProvider?: string;
};

export type WorkAdmissionContext = WorkModelContext & {
  allowedModels: Array<{ id: string; provider?: string }>;
};

export type WorkAdmissionFailure =
  | 'WORK_AGENT_ID_INVALID'
  | 'WORK_AGENT_NOT_FOUND'
  | 'WORK_AGENT_UNAVAILABLE'
  | 'WORK_MODEL_NOT_ALLOWED'
  | 'WORK_AGENT_GRAPH_NOT_ALLOWED'
  | 'WORK_AGENT_GRAPH_TOO_LARGE'
  | 'WORK_AUTO_UNRESOLVED'
  | 'WORK_NO_FREE_MODEL';

export type WorkAdmissionResult =
  | { ok: true; context: WorkAdmissionContext }
  | { ok: false; error: WorkAdmissionFailure };

export function resolveWorkContext(
  sources: WorkModelSource[],
  requested: unknown,
  configuredDefault?: string | null,
): WorkModelContext | { error: WorkAdmissionFailure } {
  return resolveWorkContextFromOptions(
    buildWorkModelOptions(sources),
    requested,
    configuredDefault,
  );
}

function resolveWorkContextFromOptions(
  options: ReturnType<typeof buildWorkModelOptions>,
  requested: unknown,
  configuredDefault?: string | null,
): WorkModelContext | { error: WorkAdmissionFailure } {
  if (requested != null && typeof requested !== 'string') {
    return { error: 'WORK_MODEL_NOT_ALLOWED' };
  }
  const explicit = requested != null && requested !== WORK_AUTO_MODEL_ID;
  const selection = resolveWorkSelection(
    options,
    typeof requested === 'string' ? requested : WORK_AUTO_MODEL_ID,
    configuredDefault,
  );
  if (selection.ok) {
    return {
      isWork: true,
      workModel: selection.model.id,
      workProvider: selection.model.provider,
    };
  }
  if (explicit) {
    return { error: 'WORK_MODEL_NOT_ALLOWED' };
  }
  if (options.length === 0) {
    return { error: 'WORK_NO_FREE_MODEL' };
  }
  return { error: 'WORK_AUTO_UNRESOLVED' };
}

export async function resolveWorkAdmission(input: {
  sources: WorkModelSource[];
  requestedModel: unknown;
  configuredDefaultModel?: string | null;
  requestedAgentId?: string | null;
  findAgent: (agentId: string) => Promise<WorkGraphAgent | null | undefined>;
  canViewAgent: (agent: WorkGraphAgent) => Promise<boolean>;
  graphLimit?: number;
}): Promise<WorkAdmissionResult> {
  const {
    sources,
    requestedModel,
    configuredDefaultModel,
    requestedAgentId,
    findAgent,
    canViewAgent,
    graphLimit = DEFAULT_WORK_AGENT_GRAPH_LIMIT,
  } = input;

  if (requestedAgentId != null && !isValidWorkId(requestedAgentId)) {
    return { ok: false, error: 'WORK_AGENT_ID_INVALID' };
  }

  const options = buildWorkModelOptions(sources);
  const allowedModels = workConcreteModels(options).map(({ id, provider }) => ({ id, provider }));
  if (!requestedAgentId) {
    const context = resolveWorkContextFromOptions(options, requestedModel, configuredDefaultModel);
    return 'error' in context
      ? { ok: false, error: context.error }
      : { ok: true, context: { ...context, allowedModels } };
  }

  let agent: WorkGraphAgent | null | undefined;
  try {
    agent = await findAgent(requestedAgentId);
  } catch {
    return { ok: false, error: 'WORK_AGENT_UNAVAILABLE' };
  }
  if (!agent) {
    return { ok: false, error: 'WORK_AGENT_NOT_FOUND' };
  }

  const selectedModel: WorkModel | null = resolveWorkAgentModel(options, agent);
  if (!selectedModel) {
    return { ok: false, error: 'WORK_MODEL_NOT_ALLOWED' };
  }

  let graph: WorkAgentGraph;
  try {
    graph = await resolveWorkAgentGraph(
      { ...agent, id: requestedAgentId },
      options,
      async (agentId) => {
        const member = await findAgent(agentId);
        return member && (await canViewAgent(member)) ? member : null;
      },
      graphLimit,
    );
  } catch {
    return { ok: false, error: 'WORK_AGENT_UNAVAILABLE' };
  }
  if (!graph.ok) {
    return {
      ok: false,
      error:
        graph.reason === 'too_large'
          ? 'WORK_AGENT_GRAPH_TOO_LARGE'
          : 'WORK_AGENT_GRAPH_NOT_ALLOWED',
    };
  }

  if (
    requestedModel != null &&
    requestedModel !== '' &&
    requestedModel !== WORK_AUTO_MODEL_ID &&
    requestedModel !== selectedModel.id
  ) {
    return { ok: false, error: 'WORK_MODEL_NOT_ALLOWED' };
  }

  return {
    ok: true,
    context: {
      isWork: true,
      workModel: selectedModel.id,
      workProvider: selectedModel.provider,
      allowedModels,
    },
  };
}
