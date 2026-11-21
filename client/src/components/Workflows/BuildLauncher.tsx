import { useId, useState } from 'react';
import { Rocket } from 'lucide-react';
import type { WorkflowBuildMode } from 'coderax-data-provider';
import type { FormEvent } from 'react';
import type { TranslationKeys } from '~/hooks';
import { useStartWorkflowBuildMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';

const MODE_LABELS: Record<WorkflowBuildMode, TranslationKeys> = {
  turbo15: 'com_ui_workflow_build_mode_turbo',
  autonomous: 'com_ui_workflow_build_mode_autonomous',
  verified: 'com_ui_workflow_build_mode_verified',
};

const WORKSPACE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function responseError(error: unknown): string | undefined {
  const response = (error as { response?: { data?: { error?: unknown } } } | null)?.response;
  return typeof response?.data?.error === 'string' ? response.data.error : undefined;
}

export default function BuildLauncher({
  agents,
  onStarted,
  onCancel,
}: {
  agents: Array<{ id: string; name?: string | null }>;
  onStarted: (workflowId: string) => void;
  onCancel: () => void;
}) {
  const localize = useLocalize();
  const requestId = useId();
  const modeId = useId();
  const agentId = useId();
  const repositoryId = useId();
  const baseRefId = useId();
  const workspaceId = useId();
  const [request, setRequest] = useState('');
  const [mode, setMode] = useState<WorkflowBuildMode>('autonomous');
  const [agent, setAgent] = useState(agents[0]?.id ?? '');
  const [repository, setRepository] = useState('');
  const [baseRef, setBaseRef] = useState('');
  const [workspace, setWorkspace] = useState('');
  const mutation = useStartWorkflowBuildMutation();
  const selectedAgent = agent.length > 0 ? agent : (agents[0]?.id ?? '');
  const separator = repository.indexOf('/');
  const repositoryOwner = separator > 0 ? repository.slice(0, separator).trim() : '';
  const repositoryName = separator > 0 ? repository.slice(separator + 1).trim() : '';
  const repositoryValid =
    repositoryOwner.length > 0 && repositoryName.length > 0 && !repositoryName.includes('/');
  const workspaceValid = WORKSPACE_PATTERN.test(workspace.trim());
  const complete =
    request.trim().length > 0 && selectedAgent.length > 0 && repositoryValid && workspaceValid;
  const failure =
    responseError(mutation.error) ??
    (mutation.isError ? localize('com_ui_workflow_build_failed') : undefined);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!complete || mutation.isLoading) {
      return;
    }
    mutation.mutate(
      {
        request: request.trim(),
        mode,
        agentId: selectedAgent,
        repository: {
          owner: repositoryOwner,
          name: repositoryName,
          ...(baseRef.trim().length === 0 ? {} : { baseRef: baseRef.trim() }),
        },
        workspace: workspace.trim(),
      },
      { onSuccess: ({ workflow }) => onStarted(workflow.id) },
    );
  };

  return (
    <section
      aria-labelledby={`${requestId}-title`}
      className="border-border-light bg-surface-secondary rounded-xl border p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id={`${requestId}-title`} className="text-lg font-semibold">
            {localize('com_ui_workflow_build_title')}
          </h2>
          <p className="text-text-secondary mt-1 text-sm">
            {localize('com_ui_workflow_build_subtitle')}
          </p>
        </div>
        <Rocket className="text-text-secondary h-5 w-5" aria-hidden />
      </div>

      <form className="mt-4 space-y-3" onSubmit={submit} aria-busy={mutation.isLoading}>
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor={requestId}>
            {localize('com_ui_workflow_build_request')}
          </label>
          <textarea
            id={requestId}
            className="border-border-medium bg-surface-primary w-full rounded-lg border px-3 py-2 text-sm"
            rows={4}
            maxLength={8000}
            required
            placeholder={localize('com_ui_workflow_build_request_placeholder')}
            value={request}
            onChange={(event) => setRequest(event.target.value)}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor={repositoryId}>
              {localize('com_ui_workflow_build_repository')}
            </label>
            <input
              id={repositoryId}
              className="border-border-medium bg-surface-primary w-full rounded-lg border px-3 py-2 text-sm"
              type="text"
              required
              autoComplete="off"
              spellCheck={false}
              placeholder={localize('com_ui_workflow_build_repository_placeholder')}
              value={repository}
              onChange={(event) => setRepository(event.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor={baseRefId}>
              {localize('com_ui_workflow_build_base_ref')}
            </label>
            <input
              id={baseRefId}
              className="border-border-medium bg-surface-primary w-full rounded-lg border px-3 py-2 text-sm"
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder={localize('com_ui_workflow_build_base_ref_placeholder')}
              value={baseRef}
              onChange={(event) => setBaseRef(event.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium" htmlFor={workspaceId}>
              {localize('com_ui_workflow_build_workspace')}
            </label>
            <input
              id={workspaceId}
              className="border-border-medium bg-surface-primary w-full rounded-lg border px-3 py-2 text-sm"
              type="text"
              required
              autoComplete="off"
              spellCheck={false}
              placeholder={localize('com_ui_workflow_build_workspace_placeholder')}
              value={workspace}
              onChange={(event) => setWorkspace(event.target.value)}
            />
            <p className="text-text-secondary mt-1 text-xs">
              {localize('com_ui_workflow_build_workspace_hint')}
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor={modeId}>
              {localize('com_ui_workflow_build_mode')}
            </label>
            <select
              id={modeId}
              className="border-border-medium bg-surface-primary w-full rounded-lg border px-3 py-2 text-sm"
              value={mode}
              onChange={(event) => setMode(event.target.value as WorkflowBuildMode)}
            >
              {(Object.keys(MODE_LABELS) as WorkflowBuildMode[]).map((entry) => (
                <option key={entry} value={entry}>
                  {localize(MODE_LABELS[entry])}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor={agentId}>
              {localize('com_ui_workflow_build_agent')}
            </label>
            <select
              id={agentId}
              className="border-border-medium bg-surface-primary w-full rounded-lg border px-3 py-2 text-sm"
              value={selectedAgent}
              disabled={agents.length === 0}
              onChange={(event) => setAgent(event.target.value)}
            >
              {agents.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name ?? entry.id}
                </option>
              ))}
            </select>
          </div>
        </div>

        {agents.length === 0 && (
          <p className="text-text-secondary text-sm">{localize('com_ui_workflow_no_agents')}</p>
        )}
        {failure != null && (
          <p role="alert" className="text-status-error text-sm">
            {failure}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            className="bg-surface-submit flex items-center gap-1 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
            disabled={mutation.isLoading || !complete}
          >
            <Rocket className="h-4 w-4" aria-hidden />
            {mutation.isLoading
              ? localize('com_ui_workflow_build_starting')
              : localize('com_ui_workflow_build_start')}
          </button>
          <button
            type="button"
            className="border-border-medium rounded-md border px-3 py-1.5 text-sm"
            onClick={onCancel}
          >
            {localize('com_ui_workflow_cancel')}
          </button>
        </div>
      </form>
    </section>
  );
}
