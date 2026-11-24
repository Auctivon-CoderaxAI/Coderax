import { ArrowLeft, Gamepad2 } from 'lucide-react';
import { Button, Skeleton } from '@coderax/client';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useGameCapabilitiesQuery, useGameProjectQuery } from '~/data-provider';
import { CAMERA_LABEL_KEYS, GENRE_LABEL_KEYS } from './labels';
import GameUnavailable from './GameUnavailable';
import GameSpecForm from './GameSpecForm';
import { useLocalize } from '~/hooks';

const TABS = ['overview', 'spec', 'builds', 'playtests', 'agent'] as const;
type WorkspaceTab = (typeof TABS)[number];

const TAB_LABEL_KEYS = {
  overview: 'com_games_tab_overview',
  spec: 'com_games_tab_spec',
  builds: 'com_games_tab_builds',
  playtests: 'com_games_tab_playtests',
  agent: 'com_games_tab_agent',
} as const satisfies Record<WorkspaceTab, string>;

const isTab = (value: string | null): value is WorkspaceTab =>
  value != null && (TABS as readonly string[]).includes(value);

const responseStatus = (error: unknown): number | undefined =>
  (error as { response?: { status?: number } } | null)?.response?.status;

export default function GameWorkspace() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { gameId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const tab: WorkspaceTab = isTab(requestedTab) ? requestedTab : 'overview';
  const projectQuery = useGameProjectQuery(gameId);
  const capabilities = useGameCapabilitiesQuery();

  const selectTab = (next: WorkspaceTab) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'overview') {
      params.delete('tab');
    } else {
      params.set('tab', next);
    }
    setSearchParams(params, { replace: true });
  };

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
          <GameUnavailable
            tone="warning"
            title={
              notFound
                ? localize('com_games_workspace_not_found_title')
                : localize('com_games_workspace_error_title')
            }
            body={
              notFound
                ? localize('com_games_workspace_not_found_body')
                : localize('com_games_workspace_error_body')
            }
            className="bg-surface-secondary"
          />
          <div className="mt-4 flex flex-wrap gap-2">
            {!notFound ? (
              <Button type="button" variant="outline" onClick={() => projectQuery.refetch()}>
                {localize('com_games_retry')}
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={() => navigate('/games')}>
              {localize('com_games_back')}
            </Button>
          </div>
        </div>
      </main>
    );
  }

  const project = projectQuery.data;
  if (!project) {
    return (
      <main className="bg-surface-primary h-full min-h-0 w-full overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-10 md:px-8">
          <GameUnavailable
            tone="warning"
            title={localize('com_games_workspace_not_found_title')}
            body={localize('com_games_workspace_not_found_body')}
          />
          <Button
            type="button"
            variant="outline"
            className="mt-4"
            onClick={() => navigate('/games')}
          >
            {localize('com_games_back')}
          </Button>
        </div>
      </main>
    );
  }

  const spec = project.spec;
  const capabilityBody = capabilities.data?.reason ?? localize('com_games_unavailable_body');
  const playersLabel = (() => {
    if (!spec) {
      return '—';
    }
    return spec.players === 1
      ? localize('com_games_players_solo')
      : localize('com_games_players_two');
  })();

  return (
    <main className="bg-surface-primary h-full min-h-0 w-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">
        <Link
          to="/games"
          className="text-text-secondary hover:text-text-primary focus-visible:ring-ring-primary inline-flex items-center gap-2 rounded-lg text-sm focus-visible:ring-2 focus-visible:outline-none"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {localize('com_games_back')}
        </Link>

        <header className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="bg-surface-tertiary text-text-secondary flex size-10 shrink-0 items-center justify-center rounded-xl">
              <Gamepad2 className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h1 className="text-text-primary truncate text-2xl font-semibold tracking-tight">
                {project.name}
              </h1>
              <p className="text-text-tertiary mt-0.5 text-xs">
                {project.status === 'spec_ready'
                  ? localize('com_games_status_spec_ready')
                  : localize('com_games_status_draft')}
                <span aria-hidden="true"> · </span>
                {localize('com_games_revision', { 0: project.revision })}
              </p>
            </div>
          </div>
        </header>

        <div
          className="border-border-light mt-5 flex gap-1 overflow-x-auto border-b pb-px"
          role="tablist"
          aria-label={localize('com_games_workspace_tabs_label')}
        >
          {TABS.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              id={`game-tab-${item}`}
              aria-selected={tab === item}
              aria-controls={`game-panel-${item}`}
              onClick={() => selectTab(item)}
              className={
                tab === item
                  ? 'text-text-primary border-accent-primary -mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium'
                  : 'text-text-secondary hover:text-text-primary shrink-0 border-b-2 border-transparent px-3 py-2 text-sm font-medium'
              }
            >
              {localize(TAB_LABEL_KEYS[item])}
            </button>
          ))}
        </div>

        <div
          className="mt-5"
          role="tabpanel"
          id={`game-panel-${tab}`}
          aria-labelledby={`game-tab-${tab}`}
        >
          {tab === 'overview' ? (
            <div className="space-y-4">
              <section className="border-border-light bg-surface-secondary rounded-2xl border p-5">
                <h2 className="text-text-primary text-sm font-semibold">
                  {localize('com_games_overview_brief')}
                </h2>
                <p className="text-text-secondary mt-1 text-sm leading-6">
                  {project.summary || localize('com_games_summary_empty')}
                </p>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                  <div>
                    <dt className="text-text-tertiary">{localize('com_games_genre_label')}</dt>
                    <dd className="text-text-primary mt-0.5">
                      {spec ? localize(GENRE_LABEL_KEYS[spec.genre]) : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-text-tertiary">{localize('com_games_camera_label')}</dt>
                    <dd className="text-text-primary mt-0.5">
                      {spec ? localize(CAMERA_LABEL_KEYS[spec.camera]) : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-text-tertiary">{localize('com_games_players_label')}</dt>
                    <dd className="text-text-primary mt-0.5">{playersLabel}</dd>
                  </div>
                  <div>
                    <dt className="text-text-tertiary">{localize('com_games_spec_revision')}</dt>
                    <dd className="text-text-primary mt-0.5">{project.specRevision}</dd>
                  </div>
                </dl>
              </section>

              {spec ? (
                <section className="border-border-light bg-surface-secondary rounded-2xl border p-5">
                  <h2 className="text-text-primary text-sm font-semibold">
                    {localize('com_games_tab_spec')}
                  </h2>
                  <p className="text-text-secondary mt-1 text-sm leading-6">{spec.prompt}</p>
                  <dl className="mt-3 space-y-2 text-xs">
                    {spec.coreLoop ? (
                      <div>
                        <dt className="text-text-tertiary">
                          {localize('com_games_core_loop_label')}
                        </dt>
                        <dd className="text-text-secondary mt-0.5">{spec.coreLoop}</dd>
                      </div>
                    ) : null}
                    {spec.winCondition ? (
                      <div>
                        <dt className="text-text-tertiary">
                          {localize('com_games_win_condition_label')}
                        </dt>
                        <dd className="text-text-secondary mt-0.5">{spec.winCondition}</dd>
                      </div>
                    ) : null}
                    {spec.artDirection ? (
                      <div>
                        <dt className="text-text-tertiary">
                          {localize('com_games_art_direction_label')}
                        </dt>
                        <dd className="text-text-secondary mt-0.5">{spec.artDirection}</dd>
                      </div>
                    ) : null}
                  </dl>
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-4"
                    onClick={() => selectTab('spec')}
                  >
                    {localize('com_games_edit_spec')}
                  </Button>
                </section>
              ) : (
                <section className="border-border-light bg-surface-secondary rounded-2xl border p-5">
                  <h2 className="text-text-primary text-sm font-semibold">
                    {localize('com_games_spec_empty_title')}
                  </h2>
                  <p className="text-text-secondary mt-1 text-sm leading-6">
                    {localize('com_games_spec_empty_body')}
                  </p>
                  <Button
                    type="button"
                    variant="default"
                    className="mt-4"
                    onClick={() => selectTab('spec')}
                  >
                    {localize('com_games_write_spec')}
                  </Button>
                </section>
              )}

              <section className="border-border-light bg-surface-secondary rounded-2xl border p-5">
                <h2 className="text-text-primary text-sm font-semibold">
                  {localize('com_games_next_title')}
                </h2>
                <ol className="text-text-secondary mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-6">
                  <li>{localize('com_games_next_spec')}</li>
                  <li>{localize('com_games_next_executor')}</li>
                  <li>{localize('com_games_next_simulation')}</li>
                </ol>
              </section>

              <GameUnavailable
                title={localize('com_games_unavailable_title')}
                body={capabilityBody}
                code="409 EXECUTOR_UNAVAILABLE"
              />
            </div>
          ) : null}

          {/* Mounted on every tab so switching away keeps the unsaved draft. */}
          <div className={tab === 'spec' ? '' : 'hidden'}>
            <section className="border-border-light bg-surface-secondary rounded-2xl border p-5">
              <h2 className="text-text-primary text-sm font-semibold">
                {localize('com_games_spec_edit_title')}
              </h2>
              <p className="text-text-secondary mt-1 mb-4 text-sm leading-6">
                {localize('com_games_spec_edit_body')}
              </p>
              <GameSpecForm project={project} />
            </section>
          </div>

          {tab === 'builds' ? (
            <GameUnavailable
              title={localize('com_games_builds_title')}
              body={localize('com_games_builds_body')}
              code="409 EXECUTOR_UNAVAILABLE"
            />
          ) : null}

          {tab === 'playtests' ? (
            <GameUnavailable
              title={localize('com_games_playtests_title')}
              body={localize('com_games_playtests_body')}
              code="409 EXECUTOR_UNAVAILABLE"
            />
          ) : null}

          {tab === 'agent' ? (
            <GameUnavailable
              title={localize('com_games_agent_title')}
              body={localize('com_games_agent_body')}
              code="409 EXECUTOR_UNAVAILABLE"
            />
          ) : null}
        </div>
      </div>
    </main>
  );
}
