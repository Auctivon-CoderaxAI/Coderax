import { EModelEndpoint, WORK_AUTO_MODEL_ID } from 'coderax-data-provider';
import type { TEphemeralAgent, TWorkAgent, TWorkModel } from 'coderax-data-provider';

/** Shared sentinel for "let Coderax choose": no saved agent, and the server's model route. */
export const WORK_AUTOMATIC = WORK_AUTO_MODEL_ID;

/** The owner-only engine id the Work route accepts without a provider endpoint. */
export const WORK_OPENCODE_ENGINE = 'opencode' as const;

/** Built-in Work modes are presets over the automatic agent, not saved agents. */
export const WORK_MODES = ['build', 'plan', 'mission', 'skills'] as const;

export type WorkMode = (typeof WORK_MODES)[number];

export const DEFAULT_WORK_MODE: WorkMode = 'build';

const WORK_MODE_INSTRUCTIONS: Record<WorkMode, string | null> = {
  build: null,
  plan: [
    'Plan mode: investigate the request and return a concrete implementation plan with the files and steps it would touch.',
    'Do not edit files or run commands that change the workspace, and do not claim the work is complete.',
    'The user can switch to Build to execute the plan.',
  ].join(' '),
  mission: [
    'Mission mode: treat the request as a bounded goal.',
    'State the outcome, break it into milestones with acceptance criteria, execute them in order, and verify each with evidence.',
    'Report exactly what is finished, unverified or blocked; do not claim unfinished work is complete.',
  ].join(' '),
  skills: [
    'Skills mode: use the available skills as the authoritative procedure for this task.',
    'Select the relevant skills, follow their instructions, and state which skills you used in the result.',
  ].join(' '),
};

export function isWorkMode(value: unknown): value is WorkMode {
  return typeof value === 'string' && (WORK_MODES as readonly string[]).includes(value);
}

export function workModeInstruction(mode: WorkMode | undefined): string | null {
  return WORK_MODE_INSTRUCTIONS[mode ?? DEFAULT_WORK_MODE];
}

export type WorkSelection = { agentId: string; modelKey: string; mode?: WorkMode };

export const automaticWorkSelection: WorkSelection = {
  agentId: WORK_AUTOMATIC,
  modelKey: WORK_AUTOMATIC,
  mode: DEFAULT_WORK_MODE,
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
  /** The built-in mode the automatic agent runs in. */
  mode: WorkMode;
  /** Mode guidance for the automatic agent; saved agents own their instructions. */
  promptPrefix?: string;
  /** Mode-specific ephemeral capabilities; saved agents own their own config. */
  ephemeralAgent?: Pick<TEphemeralAgent, 'skills'>;
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

function soleEngineSelection(
  options: WorkOptions,
  mode: WorkMode = DEFAULT_WORK_MODE,
): WorkSelection | null {
  const model = soleEngineModel(options);
  return model ? { agentId: WORK_AUTOMATIC, modelKey: getWorkModelKey(model), mode } : null;
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
      mode: DEFAULT_WORK_MODE,
      preset: { endpoint: EModelEndpoint.agents, agent_id: agent.id, model: model.id },
    };
  }

  const mode = isWorkMode(selection.mode) ? selection.mode : DEFAULT_WORK_MODE;
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
  const promptPrefix = workModeInstruction(mode);
  const automatic = selection.modelKey === WORK_AUTOMATIC;
  return {
    agent: null,
    model,
    automatic,
    mode,
    ...(promptPrefix != null ? { promptPrefix } : {}),
    ...(mode === 'skills' ? { ephemeralAgent: { skills: true } } : {}),
    /** Keep the sentinel on the wire so the server routes each turn; the
     *  concrete model is only the endpoint choice for the automatic target. */
    preset: {
      endpoint: model.provider as EModelEndpoint,
      model: automatic ? WORK_AUTOMATIC : model.id,
    },
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
  const mode = isWorkMode(value.mode) ? value.mode : DEFAULT_WORK_MODE;
  const agent =
    typeof value.agentId === 'string'
      ? options.agents.find((option) => option.id === value.agentId)
      : undefined;
  if (agent) {
    return {
      agentId: agent.id,
      modelKey: getWorkModelKey({ id: agent.model, provider: agent.provider }),
      mode,
    };
  }
  const modelOffered =
    typeof value.modelKey === 'string' &&
    options.models.some((option) => getWorkModelKey(option) === value.modelKey);
  return (
    soleEngineSelection(options, mode) ?? {
      agentId: WORK_AUTOMATIC,
      modelKey: modelOffered ? (value.modelKey as string) : WORK_AUTOMATIC,
      mode,
    }
  );
}

/** Choosing an agent pins its model; choosing a mode returns to the automatic agent. */
export function selectWorkAgent(selection: WorkSelection, agent: TWorkAgent | null): WorkSelection {
  if (!agent) {
    return {
      agentId: WORK_AUTOMATIC,
      modelKey: selection.agentId === WORK_AUTOMATIC ? selection.modelKey : WORK_AUTOMATIC,
      mode: selection.mode ?? DEFAULT_WORK_MODE,
    };
  }
  return {
    agentId: agent.id,
    modelKey: getWorkModelKey({ id: agent.model, provider: agent.provider }),
    mode: selection.mode ?? DEFAULT_WORK_MODE,
  };
}

/** A built-in mode keeps the current model choice and uses the automatic agent. */
export function selectWorkMode(selection: WorkSelection, mode: WorkMode): WorkSelection {
  return {
    agentId: WORK_AUTOMATIC,
    modelKey: selection.modelKey,
    mode,
  };
}

/** A conversation's current fields read back as a selection, for the in-task composer. */
export function workSelectionFromConversation(
  conversation:
    | {
        endpoint?: string | null;
        agent_id?: string | null;
        model?: string | null;
        workModel?: string | null;
      }
    | null
    | undefined,
  options: WorkOptions,
): WorkSelection {
  if (conversation?.endpoint === EModelEndpoint.agents && conversation.agent_id) {
    return sanitizeWorkSelection(
      { agentId: conversation.agent_id, mode: DEFAULT_WORK_MODE },
      options,
    );
  }
  const engineModel = options.models.find(
    (option) => option.engine != null && option.id === conversation?.workModel,
  );
  if (engineModel) {
    return {
      agentId: WORK_AUTOMATIC,
      modelKey: getWorkModelKey(engineModel),
      mode: DEFAULT_WORK_MODE,
    };
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
      mode: DEFAULT_WORK_MODE,
    }
  );
}
