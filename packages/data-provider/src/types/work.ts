export const WORK_AUTO_MODEL_ID = 'auto';

export type TWorkTaskState =
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'unknown';

export type TWorkTask = {
  id: string;
  title: string;
  state: TWorkTaskState;
  createdAt?: string;
  updatedAt?: string;
  /** The concrete model the server ran the latest turn on. */
  model?: string;
  /** The saved agent the conversation runs, when it is not Coderax's default agent. */
  agentId?: string;
};

/** The concrete model the automatic option resolves to when a task starts now. */
export type TWorkModelTarget = {
  id: string;
  label: string;
  provider?: string;
};

export type TWorkModel = {
  id: string;
  label: string;
  provider?: string;
  auto?: true;
  target?: TWorkModelTarget;
};

export type TWorkModelsResponse = { models: TWorkModel[] };

/** An agent a handoff, chain or subagent graph can hand work to during one run. */
export type TWorkAgentMember = {
  id: string;
  name?: string;
  model: string;
  provider: string;
};

/**
 * An agent Work can run: the caller can view it and every agent its graph can
 * reach, and every one of them runs on a free or locally served model.
 */
export type TWorkAgent = {
  id: string;
  name?: string;
  description?: string;
  model: string;
  provider: string;
  members: TWorkAgentMember[];
};

export type TWorkAgentsResponse = { agents: TWorkAgent[] };
export type TWorkTasksResponse = { tasks: TWorkTask[] };
export type TWorkTaskResponse = { task: TWorkTask };
