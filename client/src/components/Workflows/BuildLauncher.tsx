import { useId, useRef, useState } from 'react';
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
  const [request, setRequest] = useState('');
  const [mode, setMode] = useState<WorkflowBuildMode>('autonomous');
  const [agent, setAgent] = useState(agents[0]?.id ?? '');
  const attempt = useRef<{ key: string; fields: string } | null>(null);
  const mutation = useStartWorkflowBuildMutation();
  const selectedAgent = agent.length > 0 ? agent : (agents[0]?.id ?? '');
  const failure =
    responseError(mutation.error) ??
    (mutation.isError ? localize('com_ui_workflow_build_failed') : undefined);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (request.trim().length === 0 || selectedAgent.length === 0 || mutation.isLoading) {
      return;
    }
    const payload = { request: request.trim(), mode, agentId: selectedAgent };
    const fields = JSON.stringify(payload);
    if (attempt.current?.fields !== fields) {
      attempt.current = { key: crypto.randomUUID(), fields };
    }
    const { key } = attempt.current;
    mutation.mutate(
      { ...payload, launchKey: key },
      {
        onSuccess: ({ workflow }) => {
          if (attempt.current?.key === key) attempt.current = null;
          onStarted(workflow.id);
        },
      },
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
            disabled={
              mutation.isLoading || request.trim().length === 0 || selectedAgent.length === 0
            }
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
