import { useState } from 'react';
import { useSetAtom } from 'jotai';
import { Button } from '@coderax/client';
import { RefreshCw } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { QueryKeys, SettingsTabValues } from 'coderax-data-provider';
import { settingsOpenAtom, settingsTabAtom } from '~/components/Nav/Settings';
import OpenSidebar from '~/components/Chat/Menus/OpenSidebar';
import useDrawerViewport from '~/hooks/Nav/useDrawerViewport';
import { useGetStartupConfig } from '~/data-provider';
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
type Tool = 'readiness' | 'deployments' | 'robot' | 'activity';

/** A proxy failure carries the backend's stable code, so each screen can say what to fix. */
class CyVoxRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'CyVoxRequestError';
    this.code = code;
    this.status = status;
  }
}

function getCyVoxError(error: unknown): { code: string; status?: number } | null {
  if (!error) {
    return null;
  }
  if (error instanceof CyVoxRequestError) {
    return { code: error.code, status: error.status };
  }
  return { code: 'CYVOX_UNAVAILABLE' };
}

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
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { code?: unknown } | null;
        throw new CyVoxRequestError(
          typeof body?.code === 'string' ? body.code : 'CYVOX_UNAVAILABLE',
          response.status,
        );
      }
      return (await response.json()) as T;
    },
    retry: false,
    refetchInterval: resource === 'tasks' || resource.endsWith('/approvals') ? 5000 : false,
    refetchIntervalInBackground: false,
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
    if (list.isError) return <CyVoxErrorState error={list.error} />;
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
  const send = async (
    path: string,
    body: object = {},
    confirmation?: string,
  ): Promise<{ ok: boolean; data?: unknown }> => {
    if (confirmation && !window.confirm(confirmation)) return { ok: false };
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
        const body = (await response.json().catch(() => null)) as { code?: unknown } | null;
        throw new CyVoxRequestError(
          typeof body?.code === 'string' ? body.code : 'CYVOX_UNAVAILABLE',
          response.status,
        );
      }
      // Successful action endpoints may return 204 or an empty/non-JSON body.
      // Preserve HTTP success while treating absent task metadata as unknown.
      const data: unknown =
        response.status === 204 ? undefined : await response.json().catch(() => undefined);
      setMessage(localize('com_cyvox_action_accepted'));
      void queryClient.invalidateQueries({ queryKey: [QueryKeys.cyvoxAddon] });
      return { ok: true, data };
    } catch (error) {
      const code = getCyVoxError(error)?.code;
      if (code === 'CYVOX_NOT_CONFIGURED') {
        setMessage(localize('com_cyvox_not_connected_title'));
      } else if (code === 'CYVOX_FORBIDDEN') {
        setMessage(localize('com_cyvox_forbidden'));
      } else {
        setMessage(localize('com_cyvox_unavailable'));
      }
      return { ok: false };
    } finally {
      setBusy(false);
    }
  };
  return { send, busy, message };
}
type RobotEvidence = { tasks?: Array<{ id: string; state: string; goal: string }> };
const robotOperationLabels = {
  pause: 'com_cyvox_operation_pause',
  resume: 'com_cyvox_operation_resume',
  stop: 'com_cyvox_operation_stop',
} as const;

function RobotControls() {
  const action = useCyVoxAction();
  const localize = useLocalize();
  const [goal, setGoal] = useState('');
  const evidence = useCyVox<RobotEvidence>('robotEvidence');
  const computerTasks = useCyVox<RobotEvidence>('computerTasks');
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
    return <CyVoxErrorState error={status.error ?? diagnostics.error} />;
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

function CyVoxErrorState({ error }: { error: unknown }) {
  const localize = useLocalize();
  const { data: startupConfig } = useGetStartupConfig();
  const setSettingsOpen = useSetAtom(settingsOpenAtom);
  const setSettingsTab = useSetAtom(settingsTabAtom);
  const code = getCyVoxError(error)?.code;

  if (code === 'CYVOX_FORBIDDEN') {
    return (
      <p role="alert" className="text-sm">
        {localize('com_cyvox_forbidden')}
      </p>
    );
  }

  const notConnected = code === 'CYVOX_NOT_CONFIGURED';
  return (
    <div role="alert" className="border-border-light bg-surface-primary-alt rounded-lg border p-5">
      <h2 className="font-medium">
        {localize(notConnected ? 'com_cyvox_not_connected_title' : 'com_cyvox_unreachable_title')}
      </h2>
      <p className="text-text-secondary mt-2 text-sm">
        {localize(notConnected ? 'com_cyvox_not_connected_detail' : 'com_cyvox_unreachable_detail')}
      </p>
      {notConnected && startupConfig?.cyvoxConnectionAccess === true && (
        <Button
          className="mt-3"
          variant="outline"
          size="sm"
          onClick={() => {
            setSettingsTab(SettingsTabValues.CYVOX);
            setSettingsOpen(true);
          }}
        >
          {localize('com_cyvox_open_settings')}
        </Button>
      )}
    </div>
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
  if (query.isError || !query.data) return <CyVoxErrorState error={query.error} />;
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
  const selected: Tool =
    tool === 'deployments' || tool === 'robot' || tool === 'activity' || tool === 'readiness'
      ? tool
      : 'readiness';
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: [QueryKeys.cyvoxAddon] });
  };
  if (location.pathname === '/cyvox/work') {
    return (
      <Navigate
        to={{ pathname: '/work', search: location.search, hash: location.hash }}
        state={location.state}
        replace
      />
    );
  }
  return (
    <main className="bg-surface-primary text-text-primary flex h-full min-h-0 flex-col overflow-hidden">
      <header className="from-surface-canvas via-surface-canvas/70 flex h-[3.25rem] shrink-0 items-center gap-2 bg-gradient-to-b to-transparent p-2 font-semibold">
        <div className={isSmallScreen ? 'flex flex-shrink-0 items-center' : 'hidden'}>
          <OpenSidebar />
        </div>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={refresh}>
          <RefreshCw className="mr-2 size-4" aria-hidden="true" />
          {localize('com_cyvox_refresh')}
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-4 pb-6">
          <header className="mt-4 mb-6">
            <p className="text-text-secondary text-sm">{localize('com_cyvox_brand')}</p>
            <h1 className="text-2xl font-semibold">{localize(titles[selected])}</h1>
          </header>
          {selected === 'readiness' && <ReadinessView />}
          {selected === 'deployments' && <DeploymentsView />}
          {selected === 'robot' && <RobotView />}
          {selected === 'activity' && <ActivityView />}
        </div>
      </div>
    </main>
  );
}
