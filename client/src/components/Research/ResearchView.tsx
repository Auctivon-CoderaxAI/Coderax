import { useDeferredValue, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Microscope, Plus, Search } from 'lucide-react';
import { Button, EmptyState, Skeleton } from '@coderax/client';
import type { TResearchDossier } from 'coderax-data-provider';
import { useResearchCapabilitiesQuery, useResearchProjectsInfiniteQuery } from '~/data-provider';
import { NOT_READY_CLASS, READY_CLASS, STATUS_LABEL_KEYS } from './labels';
import { useLocalize } from '~/hooks';

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function ResearchCard({ project }: { project: TResearchDossier }) {
  const localize = useLocalize();

  return (
    <Link
      to={`/research/${project._id}`}
      className="border-border-light bg-surface-secondary hover:bg-surface-hover focus-visible:ring-ring-primary group flex min-h-[9rem] flex-col rounded-2xl border p-4 transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:outline-none motion-reduce:transition-none"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="bg-surface-tertiary text-text-secondary flex size-9 shrink-0 items-center justify-center rounded-xl">
          <Microscope className="size-4" aria-hidden="true" />
        </span>
        <span className={project.audit.ready ? READY_CLASS : NOT_READY_CLASS}>
          {localize(STATUS_LABEL_KEYS[project.status])}
        </span>
      </div>
      <h2 className="text-text-primary mt-3 line-clamp-1 text-sm font-semibold tracking-tight">
        {project.title}
      </h2>
      <p className="text-text-secondary mt-1 line-clamp-2 text-sm leading-relaxed">
        {project.question || localize('com_research_question_empty')}
      </p>
      <div className="text-text-tertiary mt-auto flex flex-wrap items-center gap-2 pt-3 text-xs">
        <span>{localize('com_research_card_sources', { 0: project.audit.sources })}</span>
        <span aria-hidden="true">·</span>
        <span>{localize('com_research_card_claims', { 0: project.audit.claims })}</span>
        <span aria-hidden="true">·</span>
        <span>
          {project.audit.issues.length === 0
            ? localize('com_research_card_no_issues')
            : localize('com_research_card_issues', { 0: project.audit.issues.length })}
        </span>
        <span aria-hidden="true">·</span>
        <time dateTime={project.updatedAt}>{formatDate(project.updatedAt)}</time>
      </div>
    </Link>
  );
}

export default function ResearchView() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const trimmedSearch = deferredSearch.trim();
  const capability = useResearchCapabilitiesQuery();
  const query = useResearchProjectsInfiniteQuery({
    search: trimmedSearch || undefined,
    limit: 24,
  });

  const projects = query.data?.pages.flatMap((page) => page.projects) ?? [];
  const isLoading = query.isLoading && projects.length === 0;
  const isEmpty = !isLoading && !query.isError && projects.length === 0;

  if (capability.isSuccess && !capability.data.canAccess) {
    return (
      <main className="bg-surface-primary h-full min-h-0 w-full overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-10 md:px-8">
          <div className="border-border-light bg-surface-secondary rounded-2xl border px-5 py-6">
            <h1 className="text-text-primary flex items-center gap-2 text-sm font-semibold">
              <Microscope className="size-4" aria-hidden="true" />
              {localize('com_research_access_denied_title')}
            </h1>
            <p className="text-text-secondary mt-1 text-sm leading-6">
              {localize('com_research_access_denied_body')}
            </p>
          </div>
          <div className="mt-4">
            <Button type="button" variant="outline" onClick={() => navigate('/')}>
              {localize('com_research_back_to_chat')}
            </Button>
          </div>
        </div>
      </main>
    );
  }

  const renderProjects = () => {
    if (isLoading) {
      return (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-[9rem] rounded-2xl" aria-hidden="true" />
          ))}
        </div>
      );
    }
    if (query.isError) {
      return (
        <div
          className="border-border-light bg-surface-secondary rounded-2xl border px-5 py-6"
          role="alert"
        >
          <h2 className="text-text-primary text-sm font-semibold">
            {localize('com_research_error_list_title')}
          </h2>
          <p className="text-text-secondary mt-1 text-sm">
            {localize('com_research_error_list_body')}
          </p>
          <Button type="button" variant="outline" className="mt-4" onClick={() => query.refetch()}>
            {localize('com_research_retry')}
          </Button>
        </div>
      );
    }
    if (isEmpty) {
      const emptyAction = trimmedSearch ? (
        <Button type="button" variant="outline" onClick={() => setSearch('')}>
          {localize('com_research_search_clear')}
        </Button>
      ) : (
        <Button type="button" variant="default" onClick={() => navigate('/research/new')}>
          {localize('com_research_new')}
        </Button>
      );
      return (
        <EmptyState
          icon={Microscope}
          title={
            trimmedSearch
              ? localize('com_research_empty_search_title')
              : localize('com_research_empty_title')
          }
          description={
            trimmedSearch
              ? localize('com_research_empty_search_body')
              : localize('com_research_empty_body')
          }
          action={emptyAction}
        />
      );
    }
    return (
      <>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <ResearchCard key={project._id} project={project} />
          ))}
        </div>
        {query.hasNextPage ? (
          <div className="mt-5 flex justify-center">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (!query.isFetching) {
                  query.fetchNextPage();
                }
              }}
              disabled={query.isFetching}
            >
              {query.isFetchingNextPage
                ? localize('com_research_loading_more')
                : localize('com_research_load_more')}
            </Button>
          </div>
        ) : null}
      </>
    );
  };

  return (
    <main className="bg-surface-primary h-full min-h-0 w-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">
        <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <p className="text-text-tertiary text-xs font-semibold tracking-widest uppercase">
              {localize('com_research_eyebrow')}
            </p>
            <h1 className="text-text-primary mt-2 text-2xl font-semibold tracking-tight md:text-3xl">
              {localize('com_research_title')}
            </h1>
            <p className="text-text-secondary mt-1 max-w-2xl text-sm leading-6">
              {localize('com_research_subtitle')}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button type="button" variant="default" onClick={() => navigate('/research/new')}>
              <Plus className="size-4" aria-hidden="true" />
              {localize('com_research_new')}
            </Button>
          </div>
        </header>

        <p
          className="border-border-light bg-surface-secondary text-text-secondary mt-5 rounded-2xl border px-4 py-3 text-sm leading-6"
          role="status"
        >
          {localize('com_research_capability_fallback')}
        </p>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="relative block w-full sm:max-w-sm">
            <span className="sr-only">{localize('com_research_search_label')}</span>
            <Search
              className="text-text-tertiary pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={localize('com_research_search_placeholder')}
              className="border-border-light bg-surface-primary text-text-primary placeholder:text-text-tertiary focus-visible:ring-ring-primary h-9 w-full rounded-xl border pr-3 pl-9 text-sm focus-visible:ring-2 focus-visible:outline-none"
            />
          </label>
          <p className="text-text-tertiary text-xs" role="status">
            {query.data
              ? localize('com_research_count', { 0: projects.length })
              : localize('com_research_count_loading')}
          </p>
        </div>

        <section className="mt-4" aria-busy={isLoading}>
          {renderProjects()}
        </section>
      </div>
    </main>
  );
}
