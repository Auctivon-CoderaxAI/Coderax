import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@coderax/client';
import { QueryKeys } from 'coderax-data-provider';
import { RefreshCw } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { useAuthContext, useLocalize } from '~/hooks';

type Check = { id: string; area?: string; label: string; status: string; detail: string; action?: string };
type Readiness = { summary: string; checks: Check[]; counts: { pass: number; warn: number; fail: number } };
type Deployments = { configured: boolean; status: string };
type DeploymentList = { deployments?: Deployment[]; items?: Deployment[] };
type Deployment = { id: string; name: string; status: string; model?: string; workload?: string; region?: string; endpoint?: string; estimated_hourly_cost?: number };
type Robot = {
  control_owner: string;
  your_action_required: string;
  current_goals: number;
  automation: { paused: boolean; emergency_stopped: boolean; can_act: boolean; reason?: string };
};
type Activity = { records: Array<{ timestamp: string; connector: string; capability: string; target?: string; approval_decision?: string; result: string }> };
type Tool = 'readiness' | 'deployments' | 'robot' | 'activity';

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
        <li key={check.id} className="border-border-light bg-surface-primary-alt rounded-lg border p-4">
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
  return <ResourceView query={query} render={(data) => <><p className="mb-5">{data.summary}</p><CheckList checks={data.checks} /></>} />;
}

function DeploymentsView() {
  const query = useCyVox<Deployments>('deployments');
  const localize = useLocalize();
  const list = useCyVox<DeploymentList>('deploymentList', query.data?.configured === true);
  return <ResourceView query={query} render={(data) => <div className="space-y-4">
    <div className="border-border-light bg-surface-primary-alt rounded-lg border p-5">
      <h2 className="font-medium">{localize('com_cyvox_deployment_platform')}</h2>
      <p className="text-text-secondary mt-2 text-sm">{data.status}</p>
      {!data.configured && <p className="mt-3 text-sm">{localize('com_cyvox_deployments_unconfigured')}</p>}
    </div>
    {data.configured && (list.isLoading ? <p>{localize('com_cyvox_loading')}</p> : list.isError ? <p role="alert">{localize('com_cyvox_unavailable')}</p> :
      (list.data?.deployments ?? list.data?.items ?? []).length ? <ul className="space-y-3">{(list.data?.deployments ?? list.data?.items ?? []).map((item) => <li key={item.id} className="border-border-light bg-surface-primary-alt rounded-lg border p-4">
        <div className="flex flex-wrap justify-between gap-2"><h3 className="font-medium">{item.name}</h3><span>{item.status}</span></div>
        <p className="text-text-secondary mt-1 text-sm">{item.model ?? item.workload ?? ''} {item.region ?? ''}</p>
        {item.endpoint && <p className="text-text-secondary text-sm">{item.endpoint}</p>}
        {item.estimated_hourly_cost != null && <p className="text-text-secondary text-sm">{localize('com_cyvox_hourly_cost')}: {item.estimated_hourly_cost}</p>}
      </li>)}</ul> : <p>{localize('com_cyvox_no_deployments')}</p>)}
  </div>} />;
}

function RobotView() {
  const status = useCyVox<Robot>('robot');
  const diagnostics = useCyVox<Readiness>('robotDiagnostics');
  const localize = useLocalize();
  if (status.isLoading || diagnostics.isLoading) return <p>{localize('com_cyvox_loading')}</p>;
  if (status.isError || diagnostics.isError || !status.data || !diagnostics.data) return <p role="alert">{localize('com_cyvox_unavailable')}</p>;
  return <div className="space-y-5">
    <div className="border-border-light bg-surface-primary-alt rounded-lg border p-5">
      <h2 className="font-medium">{localize('com_cyvox_robot_control')}</h2>
      <p className="text-text-secondary mt-2 text-sm">{localize('com_cyvox_control_owner')}: {status.data.control_owner}</p>
      <p className="text-text-secondary text-sm">{localize('com_cyvox_current_goals')}: {status.data.current_goals}</p>
      <p className="text-text-secondary text-sm">{localize('com_cyvox_action_required')}: {status.data.your_action_required}</p>
      <p className="text-text-secondary text-sm">{localize('com_cyvox_control_state')}: {status.data.automation.emergency_stopped ? localize('com_cyvox_emergency_stop') : status.data.automation.paused ? localize('com_cyvox_paused') : localize('com_cyvox_enabled')}</p>
    </div>
    <p>{diagnostics.data.summary}</p>
    <CheckList checks={diagnostics.data.checks} />
  </div>;
}

function ActivityView() {
  const query = useCyVox<Activity>('activity');
  const localize = useLocalize();
  return <ResourceView query={query} render={(data) => data.records.length ? (
    <ul className="space-y-3">
      {data.records.map((record, index) => <li key={`${record.timestamp}-${index}`} className="border-border-light bg-surface-primary-alt rounded-lg border p-4">
        <div className="flex flex-wrap justify-between gap-2"><strong>{record.connector}</strong><time className="text-text-secondary text-sm">{record.timestamp}</time></div>
        <p className="text-text-secondary mt-1 text-sm">{record.capability} · {record.result}</p>
        {record.target && <p className="text-text-secondary text-sm">{record.target}</p>}
        {record.approval_decision && <p className="text-text-secondary text-sm">{record.approval_decision}</p>}
      </li>)}
    </ul>
  ) : <p>{localize('com_cyvox_no_activity')}</p>} />;
}

function ResourceView<T>({ query, render }: { query: ReturnType<typeof useCyVox<T>>; render: (data: T) => React.ReactNode }) {
  const localize = useLocalize();
  if (query.isLoading) return <p>{localize('com_cyvox_loading')}</p>;
  if (query.isError || !query.data) return <p role="alert">{localize('com_cyvox_unavailable')}</p>;
  return render(query.data);
}

const titles = {
  readiness: 'com_cyvox_readiness', deployments: 'com_cyvox_deployments',
  robot: 'com_cyvox_robot', activity: 'com_cyvox_activity',
} as const;

export default function CyVoxAddon() {
  const { tool } = useParams();
  const localize = useLocalize();
  const selected: Tool = tool === 'deployments' || tool === 'robot' || tool === 'activity' ? tool : 'readiness';
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: [QueryKeys.cyvoxAddon] });
  };
  return <main className="bg-surface-primary text-text-primary h-full overflow-y-auto p-6">
    <div className="mx-auto max-w-5xl">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-text-secondary text-sm">CyVox</p><h1 className="text-2xl font-semibold">{localize(titles[selected])}</h1></div>
        <Button variant="ghost" size="sm" onClick={refresh}><RefreshCw className="mr-2 size-4" aria-hidden="true" />{localize('com_cyvox_refresh')}</Button>
      </header>
      {selected === 'readiness' && <ReadinessView />}
      {selected === 'deployments' && <DeploymentsView />}
      {selected === 'robot' && <RobotView />}
      {selected === 'activity' && <ActivityView />}
    </div>
  </main>;
}
