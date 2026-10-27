import { useState } from 'react';
import { Button } from '@coderax/client';
import { RefreshCw } from 'lucide-react';
import { useLocation, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isCyvoxFreeOrLocalModel, QueryKeys } from 'coderax-data-provider';
import ConversationModeNav from '~/components/Chat/ConversationModeNav';
import OpenSidebar from '~/components/Chat/Menus/OpenSidebar';
import useDrawerViewport from '~/hooks/Nav/useDrawerViewport';
import { useAuthContext, useLocalize } from '~/hooks';

type Check = {
  id: string;
  area?: string;
  label: string;
  status: string;
  detail: string;
  action?: string;
};
type Readiness = {
  summary: string;
  checks: Check[];
  counts: { pass: number; warn: number; fail: number };
};
type Deployments = { configured: boolean; status: string };
type DeploymentList = { deployments?: Deployment[]; items?: Deployment[] };
type Deployment = {
  id: string;
  name: string;
  status: string;
  model?: string;
  workload?: string;
  region?: string;
  endpoint?: string;
  estimated_hourly_cost?: number;
};
type Robot = {
  control_owner: string;
  your_action_required: string;
  current_goals: number;
  automation: { paused: boolean; emergency_stopped: boolean; can_act: boolean; reason?: string };
};
type Activity = {
  records: Array<{
    timestamp: string;
    connector: string;
    capability: string;
    target?: string;
    approval_decision?: string;
    result: string;
  }>;
};
type Tool = 'readiness' | 'deployments' | 'robot' | 'activity' | 'work';

function useCyVox<T>(resource: string, enabled = true) {
  const { token } = useAuthContext();
  return useQuery<T>({
    queryKey: [QueryKeys.cyvoxAddon, resource],
    enabled: !!token && enabled,
    queryFn: async () => {
      const response = await fetch(`/api/cyvox/${resource}`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error('CYVOX_UNAVAILABLE');
      return (await response.json()) as T;
    },
    retry: false,
  });
}

function CheckList({ checks }: { checks: Check[] }) {
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {checks.map((check) => (
        <li
          key={check.id}
          className="border-border-light bg-surface-primary-alt rounded-lg border p-4"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-medium">{check.label}</h2>
            <span className="text-text-secondary text-xs uppercase">{check.status}</span>
          </div>
          <p className="text-text-secondary mt-2 text-sm">{check.detail}</p>
          {check.action && <p className="mt-2 text-sm">{check.action}</p>}
        </li>
      ))}
    </ul>
  );
}

function ReadinessView() {
  const query = useCyVox<Readiness>('readiness');
  return (
    <ResourceView
      query={query}
      render={(data) => (
        <>
          <p className="mb-5">{data.summary}</p>
          <CheckList checks={data.checks} />
        </>
      )}
    />
  );
}

function DeploymentsView() {
  const query = useCyVox<Deployments>('deployments');
  const localize = useLocalize();
  const list = useCyVox<DeploymentList>('deploymentList', query.data?.configured === true);
  const renderList = () => {
    if (list.isLoading) return <p>{localize('com_cyvox_loading')}</p>;
    if (list.isError) return <p role="alert">{localize('com_cyvox_unavailable')}</p>;
    const deployments = list.data?.deployments ?? list.data?.items ?? [];
    if (deployments.length === 0) return <p>{localize('com_cyvox_no_deployments')}</p>;
    return (
      <ul className="space-y-3">
        {deployments.map((item) => (
          <li
            key={item.id}
            className="border-border-light bg-surface-primary-alt rounded-lg border p-4"
          >
            <div className="flex flex-wrap justify-between gap-2">
              <h3 className="font-medium">{item.name}</h3>
              <span>{item.status}</span>
            </div>
            <p className="text-text-secondary mt-1 text-sm">
              {item.model ?? item.workload ?? ''} {item.region ?? ''}
            </p>
            {item.endpoint && <p className="text-text-secondary text-sm">{item.endpoint}</p>}
            {item.estimated_hourly_cost != null && (
              <p className="text-text-secondary text-sm">
                {localize('com_cyvox_hourly_cost')}: {item.estimated_hourly_cost}
              </p>
            )}
          </li>
        ))}
      </ul>
    );
  };
  return (
    <ResourceView
      query={query}
      render={(data) => (
        <div className="space-y-4">
          <div className="border-border-light bg-surface-primary-alt rounded-lg border p-5">
            <h2 className="font-medium">{localize('com_cyvox_deployment_platform')}</h2>
            <p className="text-text-secondary mt-2 text-sm">{data.status}</p>
            {!data.configured && (
              <p className="mt-3 text-sm">{localize('com_cyvox_deployments_unconfigured')}</p>
            )}
          </div>
          {data.configured && renderList()}
        </div>
      )}
    />
  );
}

// Coderax holds the JWT. CyVox's owner token never reaches browser code.
function useCyVoxAction() {
  const { token } = useAuthContext();
  const queryClient = useQueryClient();
  const localize = useLocalize();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const send = async (path: string, body: object = {}, confirmation: string): Promise<boolean> => {
    if (!window.confirm(confirmation)) return false;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/cyvox/' + path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
          'X-CyVox-Confirm': 'yes',
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error('CYVOX_UNAVAILABLE');
      }
      setMessage(localize('com_cyvox_action_accepted'));
      void queryClient.invalidateQueries({ queryKey: [QueryKeys.cyvoxAddon] });
      return true;
    } catch {
      setMessage(localize('com_cyvox_unavailable'));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { send, busy, message };
}
type CyVoxTask = { id: string; task?: string; goal?: string; state: string };
type CyVoxTaskList = { tasks: CyVoxTask[] };
type CyVoxModelList = { models: Array<{ name: string; compatible_now?: boolean }> };
type CyVoxApprovals = {
  approvals: Array<{ approval_id: string; tool?: string; description?: string }>;
};
type RobotEvidence = { tasks?: Array<{ id: string; state: string; goal: string }> };
const robotOperationLabels = {
  pause: 'com_cyvox_operation_pause',
  resume: 'com_cyvox_operation_resume',
  stop: 'com_cyvox_operation_stop',
} as const;

function TaskApprovals({ taskId }: { taskId: string }) {
  const result = useCyVox<CyVoxApprovals>('tasks/' + taskId + '/approvals');
  const action = useCyVoxAction();
  const localize = useLocalize();
  const approvals = result.data?.approvals ?? [];
  return (
    <section className="space-y-2" aria-label={localize('com_cyvox_pending_approvals')}>
      <h3 className="font-medium">{localize('com_cyvox_pending_approvals')}</h3>
      {result.isError && <p role="alert">{localize('com_cyvox_approvals_unavailable')}</p>}
      {!result.isLoading && !result.isError && approvals.length === 0 && (
        <p className="text-text-secondary text-sm">{localize('com_cyvox_no_pending_approvals')}</p>
      )}
      {approvals.map((item) => (
        <div key={item.approval_id} className="border-border-light rounded-lg border p-3">
          <p className="text-sm">{item.description || item.tool || item.approval_id}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              className="rounded-lg border px-3 py-2 text-sm"
              disabled={action.busy}
              onClick={() =>
                void action.send(
                  'tasks/' + taskId + '/approvals/' + item.approval_id,
                  { decision: 'approve_once' },
                  localize('com_cyvox_approve_once_confirmation'),
                )
              }
            >
              {localize('com_cyvox_approve_once')}
            </button>
            <button
              className="rounded-lg border px-3 py-2 text-sm"
              disabled={action.busy}
              onClick={() =>
                void action.send(
                  'tasks/' + taskId + '/approvals/' + item.approval_id,
                  { decision: 'deny' },
                  localize('com_cyvox_deny_confirmation'),
                )
              }
            >
              {localize('com_cyvox_deny')}
            </button>
          </div>
        </div>
      ))}
      {action.message && (
        <p role="status" className="text-sm">
          {action.message}
        </p>
      )}
    </section>
  );
}

function WorkView() {
  const localize = useLocalize();
  const [task, setTask] = useState('');
  const [mode, setMode] = useState<'Autonomous Run' | 'Coding Team'>('Autonomous Run');
  const [model, setModel] = useState('cyvox/auto');
  const [activeTaskId, setActiveTaskId] = useState('');
  const action = useCyVoxAction();
  const models = useCyVox<CyVoxModelList>('models');
  const tasks = useCyVox<CyVoxTaskList>('tasks');
  const choices = (models.data?.models ?? []).filter(
    (item) => item.compatible_now !== false && isCyvoxFreeOrLocalModel(item.name),
  );
  return (
    <div className="space-y-5">
      <div className="border-border-light bg-surface-primary-alt rounded-lg border p-4">
        <div className="mb-4 flex items-center justify-between">
          <p className="font-medium">{localize('com_cyvox_work_heading')}</p>
          <span className="text-text-secondary text-xs">{localize('com_cyvox_speed_note')}</span>
        </div>
        <label htmlFor="cyvox-work-task" className="mb-2 block text-sm">
          {localize('com_cyvox_work_description_label')}
        </label>
        <textarea
          id="cyvox-work-task"
          className="border-border-medium bg-surface-primary w-full rounded-lg border p-3"
          rows={5}
          maxLength={4000}
          value={task}
          onChange={(event) => setTask(event.target.value)}
          placeholder={localize('com_cyvox_work_description_placeholder')}
        />
        <div className="mt-3 flex flex-wrap gap-3">
          <label className="flex flex-col gap-1 text-sm">
            {localize('com_cyvox_execution')}
            <select
              className="border-border-medium bg-surface-primary text-text-primary rounded-lg border p-2"
              value={mode}
              onChange={(event) => setMode(event.target.value as typeof mode)}
            >
              <option value="Autonomous Run">{localize('com_cyvox_autonomous_run')}</option>
              <option value="Coding Team">{localize('com_cyvox_ai_team')}</option>
            </select>
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
            {localize('com_cyvox_model')}
            <select
              className="border-border-medium bg-surface-primary text-text-primary min-w-0 rounded-lg border p-2"
              value={model}
              onChange={(event) => setModel(event.target.value)}
            >
              <option value="cyvox/auto">{localize('com_cyvox_auto_model')}</option>
              {choices
                .filter((item) => item.name !== 'cyvox/auto')
                .map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {model !== 'cyvox/auto' && (
            <button
              type="button"
              className="rounded-lg border px-3 py-2 text-sm"
              disabled={action.busy}
              onClick={() =>
                void action.send(
                  'actions/selectModel',
                  { model },
                  localize('com_cyvox_select_model_confirmation', { model }),
                )
              }
            >
              {localize('com_cyvox_apply_model')}
            </button>
          )}
          <button
            type="button"
            className="rounded-lg border px-4 py-2 text-sm font-medium"
            disabled={action.busy || !task.trim()}
            onClick={() =>
              void action.send(
                'actions/startTask',
                { task, mode },
                localize('com_cyvox_start_work_confirmation'),
              )
            }
          >
            {localize('com_cyvox_start_work')}
          </button>
        </div>
        <p className="text-text-secondary mt-2 text-xs">{localize('com_cyvox_work_policy_note')}</p>
        {models.isError && <p role="alert">{localize('com_cyvox_models_unavailable')}</p>}
        {action.message && <p role="status">{action.message}</p>}
      </div>
      <div className="border-border-light rounded-lg border p-4">
        <h3 className="mb-2 font-medium">{localize('com_cyvox_task_progress')}</h3>
        {tasks.isError && <p role="alert">{localize('com_cyvox_tasks_unavailable')}</p>}
        {(tasks.data?.tasks ?? [])
          .slice(-12)
          .reverse()
          .map((item) => (
            <div
              key={item.id}
              className="border-border-light flex flex-wrap items-center justify-between gap-2 border-b py-2"
            >
              <button
                className="text-left text-sm underline"
                onClick={() => setActiveTaskId(item.id)}
              >
                {item.task || item.goal || item.id} · {item.state}
              </button>
              <button
                className="rounded border px-2 py-1 text-xs"
                disabled={action.busy}
                onClick={() =>
                  void action.send(
                    'tasks/' + item.id + '/cancel',
                    {},
                    localize('com_cyvox_cancel_task_confirmation'),
                  )
                }
              >
                {localize('com_cyvox_cancel')}
              </button>
            </div>
          ))}
        {activeTaskId && <TaskApprovals taskId={activeTaskId} />}
      </div>
    </div>
  );
}

function RobotControls() {
  const action = useCyVoxAction();
  const localize = useLocalize();
  const [goal, setGoal] = useState('');
  const evidence = useCyVox<RobotEvidence>('robotEvidence');
  const computerTasks = useCyVox<CyVoxTaskList>('computerTasks');
  return (
    <div className="space-y-4">
      <section className="border-border-light rounded-lg border p-4">
        <h3 className="font-medium">{localize('com_cyvox_robot_controls')}</h3>
        <p className="text-text-secondary my-2 text-sm">
          {localize('com_cyvox_robot_requirements')}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-lg border px-3 py-2 text-sm"
            disabled={action.busy}
            onClick={() =>
              void action.send(
                'actions/robotGiveBack',
                {},
                localize('com_cyvox_give_back_confirmation'),
              )
            }
          >
            {localize('com_cyvox_give_control_back')}
          </button>
          <button
            className="border-border-destructive rounded-lg border px-3 py-2 text-sm"
            disabled={action.busy}
            onClick={() =>
              void action.send(
                'actions/robotStop',
                {},
                localize('com_cyvox_emergency_stop_confirmation'),
              )
            }
          >
            {localize('com_cyvox_emergency_stop_button')}
          </button>
        </div>
        <label className="mt-4 block text-sm" htmlFor="cyvox-robot-goal">
          {localize('com_cyvox_new_computer_task')}
        </label>
        <textarea
          className="border-border-medium mt-1 w-full rounded-lg border p-2"
          id="cyvox-robot-goal"
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          rows={3}
          maxLength={4000}
          placeholder={localize('com_cyvox_computer_task_placeholder')}
        />
        <button
          className="mt-2 rounded-lg border px-3 py-2 text-sm"
          disabled={action.busy || !goal.trim()}
          onClick={() =>
            void action.send(
              'actions/startComputerTask',
              { goal },
              localize('com_cyvox_submit_computer_task_confirmation'),
            )
          }
        >
          {localize('com_cyvox_submit_computer_task')}
        </button>
        {action.message && (
          <p role="status" className="mt-2 text-sm">
            {action.message}
          </p>
        )}
      </section>
      <section className="border-border-light rounded-lg border p-4">
        <h3 className="font-medium">{localize('com_cyvox_computer_tasks')}</h3>
        {computerTasks.isError && (
          <p role="alert">{localize('com_cyvox_computer_tasks_unavailable')}</p>
        )}
        {(computerTasks.data?.tasks ?? []).slice(-8).map((item) => (
          <div
            key={item.id}
            className="border-border-light flex flex-wrap items-center gap-2 border-b py-2 text-sm"
          >
            <span className="min-w-0 flex-1">
              {item.goal || item.id} · {item.state}
            </span>
            {(['pause', 'resume', 'stop'] as const).map((operation) => (
              <button
                key={operation}
                disabled={action.busy}
                className="rounded border px-2 py-1"
                onClick={() =>
                  void action.send(
                    'computerTasks/' + item.id + '/' + operation,
                    {},
                    localize('com_cyvox_robot_task_confirmation', {
                      operation: localize(robotOperationLabels[operation]),
                    }),
                  )
                }
              >
                {localize(robotOperationLabels[operation])}
              </button>
            ))}
          </div>
        ))}
        <h3 className="mt-4 font-medium">{localize('com_cyvox_recent_robot_evidence')}</h3>
        {evidence.isError && <p role="alert">{localize('com_cyvox_evidence_unavailable')}</p>}
        {(evidence.data?.tasks ?? []).slice(0, 8).map((item) => (
          <p className="text-text-secondary py-1 text-sm" key={item.id}>
            {item.goal} · {item.state}
          </p>
        ))}
      </section>
    </div>
  );
}

function RobotView() {
  const status = useCyVox<Robot>('robot');
  const diagnostics = useCyVox<Readiness>('robotDiagnostics');
  const localize = useLocalize();
  if (status.isLoading || diagnostics.isLoading) return <p>{localize('com_cyvox_loading')}</p>;
  if (status.isError || diagnostics.isError || !status.data || !diagnostics.data)
    return <p role="alert">{localize('com_cyvox_unavailable')}</p>;
  let controlState = localize('com_cyvox_enabled');
  if (status.data.automation.paused) controlState = localize('com_cyvox_paused');
  if (status.data.automation.emergency_stopped) controlState = localize('com_cyvox_emergency_stop');
  return (
    <div className="space-y-5">
      <div className="border-border-light bg-surface-primary-alt rounded-lg border p-5">
        <h2 className="font-medium">{localize('com_cyvox_robot_control')}</h2>
        <p className="text-text-secondary mt-2 text-sm">
          {localize('com_cyvox_control_owner')}: {status.data.control_owner}
        </p>
        <p className="text-text-secondary text-sm">
          {localize('com_cyvox_current_goals')}: {status.data.current_goals}
        </p>
        <p className="text-text-secondary text-sm">
          {localize('com_cyvox_action_required')}: {status.data.your_action_required}
        </p>
        <p className="text-text-secondary text-sm">
          {localize('com_cyvox_control_state')}: {controlState}
        </p>
      </div>
      <p>{diagnostics.data.summary}</p>
      <CheckList checks={diagnostics.data.checks} />
      <RobotControls />
    </div>
  );
}

function ActivityView() {
  const query = useCyVox<Activity>('activity');
  const localize = useLocalize();
  return (
    <ResourceView
      query={query}
      render={(data) => {
        if (data.records.length === 0) {
          return <p>{localize('com_cyvox_no_activity')}</p>;
        }
        return (
          <ul className="space-y-3">
            {data.records.map((record, index) => (
              <li
                key={`${record.timestamp}-${index}`}
                className="border-border-light bg-surface-primary-alt rounded-lg border p-4"
              >
                <div className="flex flex-wrap justify-between gap-2">
                  <strong>{record.connector}</strong>
                  <time className="text-text-secondary text-sm">{record.timestamp}</time>
                </div>
                <p className="text-text-secondary mt-1 text-sm">
                  {record.capability} · {record.result}
                </p>
                {record.target && <p className="text-text-secondary text-sm">{record.target}</p>}
                {record.approval_decision && (
                  <p className="text-text-secondary text-sm">{record.approval_decision}</p>
                )}
              </li>
            ))}
          </ul>
        );
      }}
    />
  );
}

function ResourceView<T>({
  query,
  render,
}: {
  query: ReturnType<typeof useCyVox<T>>;
  render: (data: T) => React.ReactNode;
}) {
  const localize = useLocalize();
  if (query.isLoading) return <p>{localize('com_cyvox_loading')}</p>;
  if (query.isError || !query.data) return <p role="alert">{localize('com_cyvox_unavailable')}</p>;
  return render(query.data);
}

const titles = {
  readiness: 'com_cyvox_readiness',
  deployments: 'com_cyvox_deployments',
  robot: 'com_cyvox_robot',
  activity: 'com_cyvox_activity',
} as const;

export default function CyVoxAddon() {
  const { tool } = useParams();
  const location = useLocation();
  const localize = useLocalize();
  const isSmallScreen = useDrawerViewport();
  const savedChatPath = (location.state as { chatPath?: unknown } | null)?.chatPath;
  const chatPath =
    typeof savedChatPath === 'string' && savedChatPath.startsWith('/c/')
      ? savedChatPath
      : undefined;
  const selected: Tool =
    tool === 'deployments' || tool === 'robot' || tool === 'activity' || tool === 'work'
      ? tool
      : 'readiness';
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: [QueryKeys.cyvoxAddon] });
  };
  return (
    <main className="bg-surface-primary text-text-primary h-full overflow-y-auto">
      <header className="from-surface-canvas via-surface-canvas/70 sticky top-0 z-20 flex h-[3.25rem] items-center gap-2 bg-gradient-to-b to-transparent p-2 font-semibold">
        <div className={isSmallScreen ? 'flex flex-shrink-0 items-center' : 'hidden'}>
          <OpenSidebar />
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <ConversationModeNav
            active={selected === 'work' ? 'work' : undefined}
            chatPath={chatPath}
            labels={{
              ariaLabel: localize('com_cyvox_conversation_mode'),
              chat: localize('com_cyvox_chat'),
              work: localize('com_cyvox_work'),
            }}
          />
        </div>
        <Button variant="ghost" size="sm" onClick={refresh}>
          <RefreshCw className="mr-2 size-4" aria-hidden="true" />
          {localize('com_cyvox_refresh')}
        </Button>
      </header>
      <div className="mx-auto max-w-5xl px-4 pb-6">
        <header className="mt-4 mb-6">
          <p className="text-text-secondary text-sm">{localize('com_cyvox_brand')}</p>
          <h1 className="text-2xl font-semibold">
            {selected === 'work' ? localize('com_cyvox_work') : localize(titles[selected])}
          </h1>
        </header>
        {selected === 'readiness' && <ReadinessView />}
        {selected === 'deployments' && <DeploymentsView />}
        {selected === 'robot' && <RobotView />}
        {selected === 'activity' && <ActivityView />}
        {selected === 'work' && <WorkView />}
      </div>
    </main>
  );
}
