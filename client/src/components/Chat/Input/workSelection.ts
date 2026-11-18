import { EModelEndpoint, WORK_AUTO_MODEL_ID } from 'coderax-data-provider';
import type { TWorkAgent, TWorkModel } from 'coderax-data-provider';

/** Shared sentinel for "let Coderax choose": no saved agent, and the server's model route. */
export const WORK_AUTOMATIC = WORK_AUTO_MODEL_ID;

/** The owner-only engine id the Work route accepts without a provider endpoint. */
export const WORK_OPENCODE_ENGINE = 'opencode' as const;

export type WorkSelection = { agentId: string; modelKey: string };

export const automaticWorkSelection: WorkSelection = {
  agentId: WORK_AUTOMATIC,
  modelKey: WORK_AUTOMATIC,
};

/** What the server offers right now. Nothing outside it is ever selectable. */
export type WorkOptions = {
  /** The automatic option, present only when the server named a model it resolves to. */
  auto: TWorkModel | null;
  models: TWorkModel[];
  agents: TWorkAgent[];
};

/** The conversation fields a selection starts a task with. */
export type WorkPreset = { endpoint: EModelEndpoint; model: string; agent_id?: string };

export type ResolvedWorkSelection = {
  agent: TWorkAgent | null;
  /** The concrete model the task runs on. */
  model: TWorkModel;
  /** The model came from automatic routing rather than an explicit pick. */
  automatic: boolean;
  preset: WorkPreset;
};

export function getWorkModelKey(model: Pick<TWorkModel, 'id' | 'provider'>): string {
  return JSON.stringify([model.provider ?? '', model.id]);
}

/** A sole engine is the only concrete choice when the server has no automatic target. */
function soleEngineModel(options: WorkOptions): TWorkModel | null {
  if (options.auto != null || options.models.length !== 1) {
    return null;
  }
  return options.models[0].engine != null ? options.models[0] : null;
}

function soleEngineSelection(options: WorkOptions): WorkSelection | null {
  const model = soleEngineModel(options);
  return model ? { agentId: WORK_AUTOMATIC, modelKey: getWorkModelKey(model) } : null;
}

/** An agent is offered only when its model is still among the concrete models. */
export function toWorkOptions(
  models: TWorkModel[] | undefined,
  agents: TWorkAgent[] | undefined,
): WorkOptions {
  const concrete = (models ?? []).filter(
    (model) => model.auto !== true && typeof model.provider === 'string' && model.provider !== '',
  );
  const offered = new Set(concrete.map(getWorkModelKey));
  const auto = (models ?? []).find((model) => model.auto === true && model.target != null) ?? null;
  const autoOffered =
    auto?.target != null &&
    offered.has(getWorkModelKey({ id: auto.target.id, provider: auto.target.provider }));
  return {
    auto: autoOffered ? auto : null,
    models: concrete,
    agents: (agents ?? []).filter((agent) =>
      offered.has(getWorkModelKey({ id: agent.model, provider: agent.provider })),
    ),
  };
}

/** The concrete model and starting preset for a selection, or null when it is not offered. */
export function resolveWorkSelection(
  selection: WorkSelection,
  options: WorkOptions,
): ResolvedWorkSelection | null {
  if (selection.agentId !== WORK_AUTOMATIC) {
    const agent = options.agents.find((option) => option.id === selection.agentId);
    const model = agent
      ? options.models.find(
          (option) => option.id === agent.model && option.provider === agent.provider,
        )
      : undefined;
    if (!agent || !model) {
      return null;
    }
    return {
      agent,
      model,
      automatic: false,
      preset: { endpoint: EModelEndpoint.agents, agent_id: agent.id, model: model.id },
    };
  }

  const target = options.auto?.target;
  const model =
    selection.modelKey === WORK_AUTOMATIC
      ? (options.models.find(
          (option) => option.id === target?.id && option.provider === target?.provider,
        ) ?? soleEngineModel(options))
      : options.models.find((option) => getWorkModelKey(option) === selection.modelKey);
  if (!model?.provider) {
    return null;
  }
  return {
    agent: null,
    model,
    automatic: selection.modelKey === WORK_AUTOMATIC,
    preset: { endpoint: model.provider as EModelEndpoint, model: model.id },
  };
}

/**
 * A remembered choice is honoured only while it is still offered. Anything
 * else falls back to automatic rather than to some other agent or model the
 * user never picked. An agent always carries its own model.
 */
export function sanitizeWorkSelection(stored: unknown, options: WorkOptions): WorkSelection {
  const value =
    stored != null && typeof stored === 'object' ? (stored as Partial<WorkSelection>) : {};
  const agent =
    typeof value.agentId === 'string'
      ? options.agents.find((option) => option.id === value.agentId)
      : undefined;
  if (agent) {
    return {
      agentId: agent.id,
      modelKey: getWorkModelKey({ id: agent.model, provider: agent.provider }),
    };
  }
  const modelOffered =
    typeof value.modelKey === 'string' &&
    options.models.some((option) => getWorkModelKey(option) === value.modelKey);
  return (
    soleEngineSelection(options) ?? {
      agentId: WORK_AUTOMATIC,
      modelKey: modelOffered ? (value.modelKey as string) : WORK_AUTOMATIC,
    }
  );
}

/** Choosing an agent pins its model; returning to automatic keeps the model choice. */
export function selectWorkAgent(selection: WorkSelection, agent: TWorkAgent | null): WorkSelection {
  if (!agent) {
    return {
      agentId: WORK_AUTOMATIC,
      modelKey: selection.agentId === WORK_AUTOMATIC ? selection.modelKey : WORK_AUTOMATIC,
    };
  }
  return {
    agentId: agent.id,
    modelKey: getWorkModelKey({ id: agent.model, provider: agent.provider }),
  };
}

/** A conversation's current fields read back as a selection, for the in-task composer. */
export function workSelectionFromConversation(
  conversation:
    | { endpoint?: string | null; agent_id?: string | null; model?: string | null }
    | null
    | undefined,
  options: WorkOptions,
): WorkSelection {
  if (conversation?.endpoint === EModelEndpoint.agents && conversation.agent_id) {
    return sanitizeWorkSelection({ agentId: conversation.agent_id }, options);
  }
  const model = options.models.find(
    (option) =>
      option.id === conversation?.model &&
      (option.engine != null || option.provider === conversation?.endpoint),
  );
  return (
    soleEngineSelection(options) ?? {
      agentId: WORK_AUTOMATIC,
      modelKey: model ? getWorkModelKey(model) : WORK_AUTOMATIC,
    }
  );
}
