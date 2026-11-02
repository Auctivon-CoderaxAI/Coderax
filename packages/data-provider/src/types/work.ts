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
};

export type TWorkModel = {
  id: string;
  label: string;
  provider?: string;
  auto?: true;
};

export type TWorkModelsResponse = { models: TWorkModel[] };
export type TWorkTasksResponse = { tasks: TWorkTask[] };
export type TWorkTaskResponse = { task: TWorkTask };
