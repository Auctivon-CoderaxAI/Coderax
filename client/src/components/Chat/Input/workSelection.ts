import { EModelEndpoint, WORK_AUTO_MODEL_ID } from 'coderax-data-provider';
import type {
  TEphemeralAgent,
  TWorkAgent,
  TWorkAgentIdentity,
  TWorkAgentId,
  TWorkModel,
} from 'coderax-data-provider';

/** Shared sentinel for "let Coderax choose": no saved agent, and the server's model route. */
export const WORK_AUTOMATIC = WORK_AUTO_MODEL_ID;

/** The owner-only engine id the Work route accepts without a provider endpoint. */
export const WORK_OPENCODE_ENGINE = 'opencode' as const;

/** Built-in Work modes are presets over the automatic agent, not saved agents. */
export const WORK_MODES = ['build', 'plan', 'mission', 'skills'] as const;

export type WorkMode = (typeof WORK_MODES)[number];

export const DEFAULT_WORK_MODE: WorkMode = 'build';

/** Fallback identities keep the selector usable when an older API has no registry. */
export const DEFAULT_WORK_AGENT_IDENTITIES: readonly TWorkAgentIdentity[] = [
  {
    id: 'coderax',
    label: 'Coderax Personal Agent',
    kind: 'native',
    engine: null,
    description: 'Coderax native agent.',
    availability: { available: true },
  },
  {
    id: 'opencode',
    label: 'OpenCode Agent',
    kind: 'external',
    engine: 'opencode',
    description: 'External OpenCode engine.',
    availability: {
      available: false,
      reason: 'unavailable',
      detail: 'External agents are not available on this server.',
    },
  },
  {
    id: 'freebuff',
    label: 'FreeBuff Agent',
    kind: 'external',
    engine: 'freebuff',
    description: 'External FreeBuff engine.',
    availability: {
      available: false,
      reason: 'unavailable',
      detail: 'External agents are not available on this server.',
    },
  },
];

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

export type WorkSelection = {
  agentId: string;
  modelKey: string;
  /** The engine identity bound to the conversation; absent legacy values mean native. */
  workAgent?: TWorkAgentId;
  mode?: WorkMode;
};

export const automaticWorkSelection: WorkSelection = {
  agentId: WORK_AUTOMATIC,
  modelKey: WORK_AUTOMATIC,
  workAgent: 'coderax',
  mode: DEFAULT_WORK_MODE,
};

/** What the server offers right now. Nothing outside it is ever selectable. */
export type WorkOptions = {
  /** The automatic option, present only when the server named a model it resolves to. */
  auto: TWorkModel | null;
  models: TWorkModel[];
  agents: TWorkAgent[];
  /** Exactly three identities: native Coderax and the two external agents. */
  identities?: TWorkAgentIdentity[];
  /** Existing AUTO/FAST/COMPLEX/AGENT routing choices, each carrying a target. */
  routing?: TWorkModel[];
};

/** The conversation fields a selection starts a task with. */
export type WorkPreset = { endpoint: EModelEndpoint; model: string; agent_id?: string };

export type NativeResolvedWorkSelection = {
  workAgent: 'coderax';
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

export type ExternalResolvedWorkSelection = {
  workAgent: Exclude<TWorkAgentId, 'coderax'>;
  agent: null;
  model: null;
  automatic: false;
  mode: WorkMode;
  promptPrefix?: string;
  ephemeralAgent?: Pick<TEphemeralAgent, 'skills'>;
  identity: TWorkAgentIdentity;
};

export type ResolvedWorkSelection = NativeResolvedWorkSelection | ExternalResolvedWorkSelection;

export function getWorkModelKey(model: Pick<TWorkModel, 'id' | 'provider'>): string {
  return JSON.stringify([model.provider ?? '', model.id]);
}

export function workAgentOf(selection: WorkSelection | null | undefined): TWorkAgentId {
  return selection?.workAgent === 'opencode' || selection?.workAgent === 'freebuff'
    ? selection.workAgent
    : 'coderax';
}

/** The model chip value shown while an external agent owns the model choice. */
export const EXTERNAL_WORK_MODEL = 'work-agent-external-model' as const;

/**
 * External engines resolve their own model, so the model control must not keep
 * naming the last native model: that would display a model this turn does not
 * run. It reports the engine that owns the choice instead.
 */
export function workModelChipValue(selection: WorkSelection): string {
  return workAgentOf(selection) === 'coderax' ? selection.modelKey : EXTERNAL_WORK_MODEL;
}

export function workIdentities(options: WorkOptions): readonly TWorkAgentIdentity[] {
  return options.identities && options.identities.length > 0
    ? options.identities
    : DEFAULT_WORK_AGENT_IDENTITIES;
}

export function workIdentity(
  options: WorkOptions,
  id: TWorkAgentId | null | undefined,
): TWorkAgentIdentity {
  return (
    workIdentities(options).find((identity) => identity.id === id) ??
    DEFAULT_WORK_AGENT_IDENTITIES.find((identity) => identity.id === id) ??
    DEFAULT_WORK_AGENT_IDENTITIES[0]
  );
}

/** A sole engine is the only concrete choice when the server has no automatic target. */
function soleEngineModel(options: WorkOptions): TWorkModel | null {
  if (options.auto != null || options.models.length !== 1) {
    return null;
  }
  return options.models[0];
}

function soleEngineSelection(
  options: WorkOptions,
  mode: WorkMode = DEFAULT_WORK_MODE,
): WorkSelection | null {
  const model = soleEngineModel(options);
  return model
    ? {
        agentId: WORK_AUTOMATIC,
        modelKey: getWorkModelKey(model),
        workAgent: 'coderax',
        mode,
      }
    : null;
}

/** An agent is offered only when its model is still among the concrete models. */
export function toWorkOptions(
  models: TWorkModel[] | undefined,
  agents: TWorkAgent[] | undefined,
  routing: TWorkModel[] | undefined = undefined,
  identities: TWorkAgentIdentity[] | undefined = undefined,
): WorkOptions {
  const concrete = (models ?? []).filter(
    (model) => model.auto !== true && typeof model.provider === 'string' && model.provider !== '',
  );
  const offered = new Set(concrete.map(getWorkModelKey));
  const auto = (models ?? []).find((model) => model.auto === true && model.target != null) ?? null;
  const autoOffered =
    auto?.target != null &&
    offered.has(getWorkModelKey({ id: auto.target.id, provider: auto.target.provider }));
  const registry =
    identities && identities.length > 0 ? identities : [...DEFAULT_WORK_AGENT_IDENTITIES];
  const legacyRouting =
    autoOffered && auto ? [{ ...auto, routingMode: 'auto' as const }] : undefined;
  const routingOptions = routing && routing.length > 0 ? routing : legacyRouting;
  return {
    auto: autoOffered ? auto : null,
    models: concrete,
    agents: (agents ?? []).filter((agent) =>
      offered.has(getWorkModelKey({ id: agent.model, provider: agent.provider })),
    ),
    identities: registry,
    ...(routingOptions ? { routing: routingOptions } : {}),
  };
}

/** The concrete model, external identity, or null when the selection is not offered. */
export function resolveWorkSelection(
  selection: WorkSelection,
  options: WorkOptions,
): ResolvedWorkSelection | null {
  const workAgent = workAgentOf(selection);
  const mode = isWorkMode(selection.mode) ? selection.mode : DEFAULT_WORK_MODE;
  const promptPrefix = workModeInstruction(mode);

  if (workAgent !== 'coderax') {
    const identity = workIdentities(options).find((option) => option.id === workAgent);
    if (!identity || !identity.availability.available) {
      return null;
    }
    return {
      workAgent,
      identity,
      agent: null,
      model: null,
      automatic: false,
      mode,
      ...(promptPrefix != null ? { promptPrefix } : {}),
    };
  }

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
      workAgent: 'coderax',
      agent,
      model,
      automatic: false,
      mode: DEFAULT_WORK_MODE,
      preset: { endpoint: EModelEndpoint.agents, agent_id: agent.id, model: model.id },
    };
  }

  const route =
    selection.modelKey === WORK_AUTOMATIC
      ? undefined
      : options.routing?.find((option) => option.routingMode === selection.modelKey);
  const target = route?.target ?? options.auto?.target;
  let model: TWorkModel | undefined;
  if (selection.modelKey === WORK_AUTOMATIC) {
    model =
      options.models.find(
        (option) => option.id === target?.id && option.provider === target?.provider,
      ) ??
      soleEngineModel(options) ??
      undefined;
  } else if (route) {
    model = options.models.find(
      (option) => option.id === target?.id && option.provider === target?.provider,
    );
  } else {
    model = options.models.find((option) => getWorkModelKey(option) === selection.modelKey);
  }
  if (!model?.provider) {
    return null;
  }
  const automatic = selection.modelKey === WORK_AUTOMATIC || route != null;
  let wireModel = model.id;
  if (route) {
    wireModel = selection.modelKey;
  } else if (automatic) {
    wireModel = WORK_AUTOMATIC;
  }
  return {
    workAgent: 'coderax',
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
      model: wireModel,
    },
  };
}

/**
 * A remembered choice is honoured only while it is still offered. Anything
 * else falls back to automatic rather than to some other agent or model the
 * user never picked. A known external identity is preserved even when it is
 * unavailable, so the UI can show why and refuse to start instead of silently
 * switching to native.
 */
export function sanitizeWorkSelection(stored: unknown, options: WorkOptions): WorkSelection {
  const value =
    stored != null && typeof stored === 'object' ? (stored as Partial<WorkSelection>) : {};
  const mode = isWorkMode(value.mode) ? value.mode : DEFAULT_WORK_MODE;
  const requestedIdentity = value.workAgent;
  const knownIdentity =
    requestedIdentity === 'coderax' ||
    requestedIdentity === 'opencode' ||
    requestedIdentity === 'freebuff'
      ? requestedIdentity
      : 'coderax';
  const identity = workIdentities(options).find((option) => option.id === knownIdentity);
  const modelKey =
    typeof value.modelKey === 'string' &&
    (options.models.some((option) => getWorkModelKey(option) === value.modelKey) ||
      options.routing?.some((option) => option.routingMode === value.modelKey) === true)
      ? value.modelKey
      : WORK_AUTOMATIC;
  if (knownIdentity !== 'coderax' && identity) {
    return {
      agentId: WORK_AUTOMATIC,
      modelKey,
      workAgent: knownIdentity,
      mode,
    };
  }

  const agent =
    typeof value.agentId === 'string'
      ? options.agents.find((option) => option.id === value.agentId)
      : undefined;
  if (agent) {
    return {
      agentId: agent.id,
      modelKey: getWorkModelKey({ id: agent.model, provider: agent.provider }),
      workAgent: 'coderax',
      mode,
    };
  }
  return (
    soleEngineSelection(options, mode) ?? {
      agentId: WORK_AUTOMATIC,
      modelKey,
      workAgent: 'coderax',
      mode,
    }
  );
}

/** Choosing a saved agent is explicitly native; choosing an identity keeps the model for native return. */
export function selectWorkAgent(selection: WorkSelection, agent: TWorkAgent | null): WorkSelection {
  if (!agent) {
    return {
      agentId: WORK_AUTOMATIC,
      modelKey:
        selection.agentId === WORK_AUTOMATIC && workAgentOf(selection) === 'coderax'
          ? selection.modelKey
          : WORK_AUTOMATIC,
      workAgent: 'coderax',
      mode: selection.mode ?? DEFAULT_WORK_MODE,
    };
  }
  return {
    agentId: agent.id,
    modelKey: getWorkModelKey({ id: agent.model, provider: agent.provider }),
    workAgent: 'coderax',
    mode: selection.mode ?? DEFAULT_WORK_MODE,
  };
}

/** Built-in modes use the automatic agent while keeping the model and identity. */
export function selectWorkMode(selection: WorkSelection, mode: WorkMode): WorkSelection {
  return {
    agentId: WORK_AUTOMATIC,
    modelKey: selection.modelKey,
    workAgent: workAgentOf(selection),
    mode,
  };
}

export function selectWorkAgentIdentity(
  selection: WorkSelection,
  workAgent: TWorkAgentId,
  options: WorkOptions,
): WorkSelection {
  const next: WorkSelection = {
    agentId: workAgent === 'coderax' ? selection.agentId : WORK_AUTOMATIC,
    modelKey: selection.modelKey,
    workAgent,
    mode: selection.mode ?? DEFAULT_WORK_MODE,
  };
  if (workAgent !== 'coderax' || workAgentOf(selection) === 'coderax') {
    return next;
  }
  const native = sanitizeWorkSelection(next, options);
  if (resolveWorkSelection(native, options)) {
    return native;
  }
  const fallback = options.models.find((model) => model.provider && model.engine == null);
  return fallback ? { ...native, modelKey: getWorkModelKey(fallback) } : native;
}

/** A conversation's current fields read back as a selection, for the in-task composer. */
export function workSelectionFromConversation(
  conversation:
    | {
        endpoint?: string | null;
        agent_id?: string | null;
        model?: string | null;
        workModel?: string | null;
        workAgent?: string | null;
      }
    | null
    | undefined,
  options: WorkOptions,
): WorkSelection {
  const storedIdentity =
    conversation?.workAgent === 'opencode' || conversation?.workAgent === 'freebuff'
      ? conversation.workAgent
      : 'coderax';
  if (storedIdentity !== 'coderax') {
    return {
      agentId: WORK_AUTOMATIC,
      modelKey: WORK_AUTOMATIC,
      workAgent: storedIdentity,
      mode: DEFAULT_WORK_MODE,
    };
  }
  if (conversation?.endpoint === EModelEndpoint.agents && conversation.agent_id) {
    return sanitizeWorkSelection(
      { agentId: conversation.agent_id, mode: DEFAULT_WORK_MODE, workAgent: 'coderax' },
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
      workAgent: 'coderax',
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
      workAgent: 'coderax',
      mode: DEFAULT_WORK_MODE,
    }
  );
}
