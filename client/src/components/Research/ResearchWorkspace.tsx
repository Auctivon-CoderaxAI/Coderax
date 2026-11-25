import { useId, useState } from 'react';
import { Button, Skeleton } from '@coderax/client';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Microscope, Trash2 } from 'lucide-react';
import {
  MAX_RESEARCH_QUESTION_LENGTH,
  MAX_RESEARCH_TITLE_LENGTH,
  RESEARCH_PROJECT_STATUSES,
  effectiveClaimStatus,
} from 'coderax-data-provider';
import type {
  TResearchClaim,
  TResearchDossier,
  TResearchProjectStatus,
  TResearchSource,
  TSaveResearchProjectRequest,
} from 'coderax-data-provider';
import {
  CLAIM_STATUS_LABEL_KEYS,
  EFFECTIVE_STATUS_CLASS,
  EFFECTIVE_STATUS_LABEL_KEYS,
  SOURCE_KIND_LABEL_KEYS,
  STATUS_LABEL_KEYS,
} from './labels';
import {
  useDeleteResearchProjectMutation,
  useResearchProjectQuery,
  useSaveResearchProjectMutation,
} from '~/data-provider';
import EvidencePanel from './EvidencePanel';
import ReportPanel from './ReportPanel';
import SourceForm from './SourceForm';
import { useLocalize } from '~/hooks';
import ClaimForm from './ClaimForm';

const FIELD_CLASS =
  'border-border-light bg-surface-primary text-text-primary placeholder:text-text-tertiary focus-visible:ring-ring-primary mt-1.5 w-full rounded-xl border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none';

const responseStatus = (error: unknown): number | undefined =>
  (error as { response?: { status?: number } } | null)?.response?.status;

const responseCode = (error: unknown): string | undefined =>
  (error as { response?: { data?: { code?: string } } } | null)?.response?.data?.code;

type SavePatch = Partial<
  Pick<TSaveResearchProjectRequest, 'title' | 'question' | 'status' | 'sources' | 'claims'>
>;

function DetailsForm({
  project,
  disabled,
  onSave,
}: {
  project: TResearchDossier;
  disabled: boolean;
  onSave: (patch: SavePatch) => void;
}) {
  const localize = useLocalize();
  const titleId = useId();
  const questionId = useId();
  const [title, setTitle] = useState(project.title);
  const [question, setQuestion] = useState(project.question);
  const [error, setError] = useState<string | null>(null);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setError(localize('com_research_title_required'));
      return;
    }
    setError(null);
    onSave({ title: trimmed, question: question.trim() });
  };

  return (
    <form
      onSubmit={submit}
      className="border-border-light bg-surface-secondary space-y-4 rounded-2xl border p-5"
    >
      <div>
        <label htmlFor={titleId} className="text-text-primary block text-sm font-medium">
          {localize('com_research_title_label')}
        </label>
        <input
          id={titleId}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={MAX_RESEARCH_TITLE_LENGTH}
          disabled={disabled}
          className={`${FIELD_CLASS} h-10`}
          aria-invalid={Boolean(error) || undefined}
        />
      </div>
      <div>
        <label htmlFor={questionId} className="text-text-primary block text-sm font-medium">
          {localize('com_research_question_label')}
        </label>
        <textarea
          id={questionId}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          maxLength={MAX_RESEARCH_QUESTION_LENGTH}
          rows={3}
          disabled={disabled}
          className={`${FIELD_CLASS} resize-y py-2 leading-6`}
        />
      </div>
      {error ? (
        <p className="text-text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="outline" disabled={disabled}>
        {localize('com_research_details_save')}
      </Button>
    </form>
  );
}

export default function ResearchWorkspace() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { researchId = '' } = useParams();
  const projectQuery = useResearchProjectQuery(researchId);
  const saveMutation = useSaveResearchProjectMutation();
  const deleteMutation = useDeleteResearchProjectMutation();
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  if (projectQuery.isLoading) {
    return (
      <main className="bg-surface-primary h-full min-h-0 w-full overflow-y-auto" aria-busy="true">
        <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6 md:px-8 md:py-8">
          <Skeleton className="h-5 w-28 rounded-md" />
          <Skeleton className="h-9 w-72 max-w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      </main>
    );
  }

  if (projectQuery.isError) {
    const notFound = responseStatus(projectQuery.error) === 404;
    return (
      <main className="bg-surface-primary h-full min-h-0 w-full overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-10 md:px-8">
          <div className="border-border-light bg-surface-secondary rounded-2xl border px-5 py-6">
            <h1 className="text-text-primary text-sm font-semibold">
              {notFound
                ? localize('com_research_workspace_not_found_title')
                : localize('com_research_workspace_error_title')}
            </h1>
            <p className="text-text-secondary mt-1 text-sm">
              {notFound
                ? localize('com_research_workspace_not_found_body')
                : localize('com_research_workspace_error_body')}
            </p>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {!notFound ? (
              <Button type="button" variant="outline" onClick={() => projectQuery.refetch()}>
                {localize('com_research_retry')}
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={() => navigate('/research')}>
              {localize('com_research_back')}
            </Button>
          </div>
        </div>
      </main>
    );
  }

  const project = projectQuery.data;
  if (!project) {
    return null;
  }

  const isComplete = project.status === 'complete';
  const saving = saveMutation.isLoading;
  const knownSourceIds = new Set(project.sources.map((source) => source.id));
  const sourceTitles = new Map(project.sources.map((source) => [source.id, source.title]));

  const save = async (patch: SavePatch): Promise<boolean> => {
    setSaveNotice(null);
    const payload: TSaveResearchProjectRequest = {
      researchId: project._id,
      title: project.title,
      question: project.question,
      status: project.status,
      sources: project.sources,
      claims: project.claims,
      ...patch,
      expectedRevision: project.revision,
    };
    try {
      await saveMutation.mutateAsync(payload);
      setSaveNotice(localize('com_research_saved'));
      return true;
    } catch (error) {
      if (responseCode(error) === 'RESEARCH_READ_ONLY') {
        setSaveNotice(localize('com_research_read_only'));
      } else if (responseStatus(error) === 409) {
        setSaveNotice(localize('com_research_conflict'));
      } else {
        setSaveNotice(localize('com_research_save_error'));
      }
      return false;
    }
  };

  const addSource = (source: TResearchSource) => save({ sources: [...project.sources, source] });
  const removeSource = (sourceId: string) =>
    save({
      sources: project.sources.filter((source) => source.id !== sourceId),
      claims: project.claims.map((claim) => ({
        ...claim,
        sourceIds: claim.sourceIds.filter((id) => id !== sourceId),
      })),
    });
  const addClaim = (claim: TResearchClaim) => save({ claims: [...project.claims, claim] });
  const removeClaim = (claimId: string) =>
    save({ claims: project.claims.filter((claim) => claim.id !== claimId) });
  const changeStatus = (status: TResearchProjectStatus) => save({ status });

  const deleteDossier = () => {
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    deleteMutation.mutate(project._id, {
      onSuccess: () => navigate('/research'),
      onError: () => setSaveNotice(localize('com_research_delete_error')),
    });
  };

  return (
    <main className="bg-surface-primary h-full min-h-0 w-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">
        <Link
          to="/research"
          className="text-text-secondary hover:text-text-primary focus-visible:ring-ring-primary inline-flex items-center gap-2 rounded-lg text-sm focus-visible:ring-2 focus-visible:outline-none"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {localize('com_research_back')}
        </Link>

        <header className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="bg-surface-tertiary text-text-secondary flex size-10 shrink-0 items-center justify-center rounded-xl">
              <Microscope className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h1 className="text-text-primary truncate text-2xl font-semibold tracking-tight">
                {project.title}
              </h1>
              <p className="text-text-tertiary mt-0.5 text-xs">
                {localize(STATUS_LABEL_KEYS[project.status])}
                <span aria-hidden="true"> · </span>
                {localize('com_research_revision', { 0: project.revision })}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <label className="text-text-secondary flex items-center gap-2 text-xs">
              <span>{localize('com_research_status_label')}</span>
              <select
                value={project.status}
                onChange={(event) => changeStatus(event.target.value as TResearchProjectStatus)}
                disabled={saving || isComplete}
                className="border-border-light bg-surface-primary text-text-primary focus-visible:ring-ring-primary h-8 rounded-lg border px-2 text-xs focus-visible:ring-2 focus-visible:outline-none"
              >
                {RESEARCH_PROJECT_STATUSES.map((status) => (
                  <option
                    key={status}
                    value={status}
                    disabled={status === 'complete' && !project.audit.ready}
                  >
                    {localize(STATUS_LABEL_KEYS[status])}
                  </option>
                ))}
              </select>
            </label>
            <Button type="button" variant="outline" onClick={deleteDossier}>
              <Trash2 className="size-4" aria-hidden="true" />
              {deleteArmed
                ? localize('com_research_delete_confirm')
                : localize('com_research_delete')}
            </Button>
          </div>
        </header>

        <p className="text-text-tertiary mt-3 min-h-5 text-xs" role="status" aria-live="polite">
          {saving ? localize('com_research_saving') : (saveNotice ?? '')}
        </p>

        {isComplete ? (
          <p className="border-border-light bg-surface-secondary text-text-secondary mt-2 rounded-xl border px-4 py-3 text-sm leading-6">
            {localize('com_research_complete_readonly')}{' '}
            <button
              type="button"
              className="text-accent-primary focus-visible:ring-ring-primary rounded underline underline-offset-2 focus-visible:ring-2 focus-visible:outline-none"
              onClick={() => changeStatus('review')}
            >
              {localize('com_research_reopen')}
            </button>
          </p>
        ) : null}

        <div className="mt-5 space-y-5">
          <section aria-labelledby="research-details-title">
            <h2
              id="research-details-title"
              className="text-text-primary mb-2 text-sm font-semibold"
            >
              {localize('com_research_details_title')}
            </h2>
            <DetailsForm
              key={project._id}
              project={project}
              disabled={saving || isComplete}
              onSave={save}
            />
          </section>

          <section
            className="border-border-light bg-surface-secondary rounded-2xl border p-5"
            aria-labelledby="research-sources-title"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 id="research-sources-title" className="text-text-primary text-sm font-semibold">
                  {localize('com_research_sources_title')}
                </h2>
                <p className="text-text-secondary mt-1 text-sm leading-6">
                  {localize('com_research_sources_subtitle')}
                </p>
              </div>
              <span className="text-text-tertiary text-xs">
                {localize('com_research_sources_count', { 0: project.sources.length })}
              </span>
            </div>

            {project.sources.length === 0 ? (
              <p className="text-text-tertiary mt-3 text-sm">
                {localize('com_research_sources_empty')}
              </p>
            ) : (
              <ol className="mt-4 space-y-2">
                {project.sources.map((source, index) => (
                  <li
                    key={source.id}
                    className="border-border-light bg-surface-primary rounded-xl border p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-text-primary text-sm font-medium">
                          <span className="text-text-tertiary mr-1.5">{index + 1}.</span>
                          {source.title}
                        </p>
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-accent-primary focus-visible:ring-ring-primary mt-0.5 inline-flex items-center gap-1 rounded text-xs break-all underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:outline-none"
                        >
                          {source.url}
                          <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                        </a>
                        <p className="text-text-tertiary mt-1 text-xs">
                          {source.publisher ? `${source.publisher} · ` : ''}
                          {localize(SOURCE_KIND_LABEL_KEYS[source.kind])}
                          {source.retrievedAt ? ` · ${source.retrievedAt}` : ''}
                        </p>
                        {source.excerpt ? (
                          <blockquote className="text-text-secondary border-border-light mt-1.5 border-l-2 pl-2 text-xs leading-5">
                            {source.excerpt}
                          </blockquote>
                        ) : null}
                        {source.note ? (
                          <p className="text-text-tertiary mt-1 text-xs">{source.note}</p>
                        ) : null}
                      </div>
                      {!isComplete ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="shrink-0"
                          onClick={() => removeSource(source.id)}
                          disabled={saving}
                        >
                          {localize('com_research_remove')}
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}

            {!isComplete ? <SourceForm disabled={saving} onAdd={addSource} /> : null}
          </section>

          <section
            className="border-border-light bg-surface-secondary rounded-2xl border p-5"
            aria-labelledby="research-claims-title"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 id="research-claims-title" className="text-text-primary text-sm font-semibold">
                  {localize('com_research_claims_title')}
                </h2>
                <p className="text-text-secondary mt-1 text-sm leading-6">
                  {localize('com_research_claims_subtitle')}
                </p>
              </div>
              <span className="text-text-tertiary text-xs">
                {localize('com_research_claims_count', { 0: project.claims.length })}
              </span>
            </div>

            {project.claims.length === 0 ? (
              <p className="text-text-tertiary mt-3 text-sm">
                {localize('com_research_claims_empty')}
              </p>
            ) : (
              <ul className="mt-4 space-y-2">
                {project.claims.map((claim) => {
                  const effective = effectiveClaimStatus(claim, knownSourceIds);
                  return (
                    <li
                      key={claim.id}
                      className="border-border-light bg-surface-primary rounded-xl border p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <span
                            className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${EFFECTIVE_STATUS_CLASS[effective]}`}
                          >
                            {localize(EFFECTIVE_STATUS_LABEL_KEYS[effective])}
                          </span>
                          <p className="text-text-primary mt-1.5 text-sm leading-6">{claim.text}</p>
                          {claim.sourceIds.length > 0 ? (
                            <p className="text-text-tertiary mt-1 text-xs">
                              {localize('com_research_claim_cites', {
                                0: claim.sourceIds
                                  .map((id) => sourceTitles.get(id))
                                  .filter(Boolean)
                                  .join(', '),
                              })}
                            </p>
                          ) : (
                            <p className="text-text-tertiary mt-1 text-xs">
                              {localize('com_research_claim_uncited')}
                              {' · '}
                              {localize(CLAIM_STATUS_LABEL_KEYS[claim.status])}
                            </p>
                          )}
                        </div>
                        {!isComplete ? (
                          <Button
                            type="button"
                            variant="outline"
                            className="shrink-0"
                            onClick={() => removeClaim(claim.id)}
                            disabled={saving}
                          >
                            {localize('com_research_remove')}
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {!isComplete ? (
              <ClaimForm sources={project.sources} disabled={saving} onAdd={addClaim} />
            ) : null}
          </section>

          <EvidencePanel audit={project.audit} />
          <ReportPanel project={project} />
        </div>
      </div>
    </main>
  );
}
