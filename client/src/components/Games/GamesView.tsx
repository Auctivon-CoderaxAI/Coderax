import { useDeferredValue, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, EmptyState, Skeleton } from '@coderax/client';
import { Gamepad2, LayoutTemplate, Plus, Search } from 'lucide-react';
import type { TGameProject } from 'coderax-data-provider';
import { useGameCapabilitiesQuery, useGameProjectsInfiniteQuery } from '~/data-provider';
import { CAMERA_LABEL_KEYS, GENRE_LABEL_KEYS } from './labels';
import GameUnavailable from './GameUnavailable';
import { useLocalize } from '~/hooks';

const SPEC_READY_CLASS =
  'border-accent-primary/30 bg-accent-primary/10 text-accent-primary rounded-full border px-2 py-0.5 text-xs font-medium';
const DRAFT_CLASS =
  'border-border-light bg-surface-tertiary text-text-secondary rounded-full border px-2 py-0.5 text-xs font-medium';

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function GameCard({ project }: { project: TGameProject }) {
  const localize = useLocalize();
  const spec = project.spec;

  return (
    <Link
      to={`/games/${project._id}`}
      className="border-border-light bg-surface-secondary hover:bg-surface-hover focus-visible:ring-ring-primary group flex min-h-[9rem] flex-col rounded-2xl border p-4 transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:outline-none motion-reduce:transition-none"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="bg-surface-tertiary text-text-secondary flex size-9 shrink-0 items-center justify-center rounded-xl">
          <Gamepad2 className="size-4" aria-hidden="true" />
        </span>
        <span className={project.status === 'spec_ready' ? SPEC_READY_CLASS : DRAFT_CLASS}>
          {project.status === 'spec_ready'
            ? localize('com_games_status_spec_ready')
            : localize('com_games_status_draft')}
        </span>
      </div>
      <h2 className="text-text-primary mt-3 line-clamp-1 text-sm font-semibold tracking-tight">
        {project.name}
      </h2>
      <p className="text-text-secondary mt-1 line-clamp-2 text-sm leading-relaxed">
        {project.summary || localize('com_games_summary_empty')}
      </p>
      <div className="text-text-tertiary mt-auto flex flex-wrap items-center gap-2 pt-3 text-xs">
        {spec ? (
          <>
            <span>{localize(GENRE_LABEL_KEYS[spec.genre])}</span>
            <span aria-hidden="true">·</span>
            <span>{localize(CAMERA_LABEL_KEYS[spec.camera])}</span>
          </>
        ) : (
          <span>{localize('com_games_spec_missing')}</span>
        )}
        <span aria-hidden="true">·</span>
        <time dateTime={project.updatedAt}>{formatDate(project.updatedAt)}</time>
      </div>
    </Link>
  );
}

export default function GamesView() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const trimmedSearch = deferredSearch.trim();
  const capability = useGameCapabilitiesQuery();
  const query = useGameProjectsInfiniteQuery({
    search: trimmedSearch || undefined,
    limit: 24,
  });

  const projects = query.data?.pages.flatMap((page) => page.projects) ?? [];
  const isLoading = query.isLoading && projects.length === 0;
  const isEmpty = !isLoading && !query.isError && projects.length === 0;

  const renderCapabilityNotice = () => {
    if (capability.isLoading) {
      return <Skeleton className="h-16 w-full rounded-2xl" aria-hidden="true" />;
    }
    if (capability.isError) {
      return (
        <GameUnavailable
          tone="warning"
          title={localize('com_games_capability_error_title')}
          body={localize('com_games_capability_error_body')}
        />
      );
    }
    return (
      <GameUnavailable
        title={localize('com_games_unavailable_title')}
        body={capability.data?.reason ?? localize('com_games_unavailable_body')}
        code="409 EXECUTOR_UNAVAILABLE"
      />
    );
  };

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
            {localize('com_games_error_list_title')}
          </h2>
          <p className="text-text-secondary mt-1 text-sm">
            {localize('com_games_error_list_body')}
          </p>
          <Button type="button" variant="outline" className="mt-4" onClick={() => query.refetch()}>
            {localize('com_games_retry')}
          </Button>
        </div>
      );
    }
    if (isEmpty) {
      const emptyAction = trimmedSearch ? (
        <Button type="button" variant="outline" onClick={() => setSearch('')}>
          {localize('com_games_search_clear')}
        </Button>
      ) : (
        <Button type="button" variant="default" onClick={() => navigate('/games/new')}>
          {localize('com_games_new')}
        </Button>
      );
      return (
        <EmptyState
          icon={Gamepad2}
          title={
            trimmedSearch
              ? localize('com_games_empty_search_title')
              : localize('com_games_empty_title')
          }
          description={
            trimmedSearch
              ? localize('com_games_empty_search_body')
              : localize('com_games_empty_body')
          }
          action={emptyAction}
        />
      );
    }
    return (
      <>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <GameCard key={project._id} project={project} />
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
                ? localize('com_games_loading_more')
                : localize('com_games_load_more')}
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
              {localize('com_games_eyebrow')}
            </p>
            <h1 className="text-text-primary mt-2 text-2xl font-semibold tracking-tight md:text-3xl">
              {localize('com_games_title')}
            </h1>
            <p className="text-text-secondary mt-1 max-w-2xl text-sm leading-6">
              {localize('com_games_subtitle')}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Link
              to="/games/templates"
              className="border-border-light text-text-primary hover:bg-surface-hover focus-visible:ring-ring-primary inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
            >
              <LayoutTemplate className="size-4" aria-hidden="true" />
              {localize('com_games_templates')}
            </Link>
            <Button type="button" variant="default" onClick={() => navigate('/games/new')}>
              <Plus className="size-4" aria-hidden="true" />
              {localize('com_games_new')}
            </Button>
          </div>
        </header>

        <div className="mt-5">{renderCapabilityNotice()}</div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="relative block w-full sm:max-w-sm">
            <span className="sr-only">{localize('com_games_search_label')}</span>
            <Search
              className="text-text-tertiary pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={localize('com_games_search_placeholder')}
              className="border-border-light bg-surface-primary text-text-primary placeholder:text-text-tertiary focus-visible:ring-ring-primary h-9 w-full rounded-xl border pr-3 pl-9 text-sm focus-visible:ring-2 focus-visible:outline-none"
            />
          </label>
          <p className="text-text-tertiary text-xs" role="status">
            {query.data
              ? localize('com_games_count', { 0: projects.length })
              : localize('com_games_count_loading')}
          </p>
        </div>

        <section className="mt-4" aria-busy={isLoading}>
          {renderProjects()}
        </section>
      </div>
    </main>
  );
}
