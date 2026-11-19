import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Spinner } from '@coderax/client';
import { dataService, QueryKeys } from 'coderax-data-provider';
import type {
  MovieShotStatus,
  TMovieJob,
  TMovieProject,
  TMovieScene,
  TMovieServiceState,
  TMovieShot,
} from 'coderax-data-provider';
import { useLocalize } from '~/hooks';

const SHOT_STATUS_CLASS: Record<MovieShotStatus, string> = {
  planned: 'bg-surface-tertiary text-text-secondary',
  queued: 'bg-surface-tertiary text-text-primary',
  generating: 'bg-surface-tertiary text-text-primary',
  blocked: 'bg-surface-tertiary text-text-destructive',
  rendered: 'bg-surface-tertiary text-text-primary',
  approved: 'bg-surface-tertiary text-text-primary',
  rejected: 'bg-surface-tertiary text-text-destructive',
};

function serviceLabel(service: TMovieServiceState): string {
  if (!service.configured) {
    return 'not configured';
  }
  return service.ready ? 'ready' : service.code ?? 'unavailable';
}

function ShotRow({
  shot,
  sceneId,
  projectId,
  busy,
  onGenerate,
  onReview,
}: {
  shot: TMovieShot;
  sceneId: string;
  projectId: string;
  busy: boolean;
  onGenerate: (sceneId: string, shotId: string) => void;
  onReview: (sceneId: string, shotId: string, decision: 'approve' | 'reject') => void;
}) {
  const localize = useLocalize();
  return (
    <div className="border-border-light grid gap-2 border-t px-3 py-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,2fr)_auto]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-text-primary text-sm font-medium">{shot.title}</span>
          <span className={`rounded px-1.5 py-0.5 text-[11px] ${SHOT_STATUS_CLASS[shot.status]}`}>
            {shot.status}
          </span>
        </div>
        <p className="text-text-secondary mt-1 text-xs">
          {shot.camera} · {shot.lensMm}mm · {shot.durationSeconds}s
        </p>
      </div>
      <div className="min-w-0">
        <p className="text-text-secondary line-clamp-2 text-xs">{shot.action}</p>
        {shot.dialogue.length > 0 && (
          <p className="text-text-primary mt-1 text-xs">
            {shot.dialogue
              .map((line) => `${line.speakerId}: "${line.text}"`)
              .join(' ')}
          </p>
        )}
        {shot.notes && <p className="text-text-destructive mt-1 text-xs">{shot.notes}</p>}
      </div>
      <div className="flex flex-wrap items-start gap-1.5">
        <Button
          size="sm"
          variant="outline"
          disabled={busy || shot.status === 'approved'}
          onClick={() => onGenerate(sceneId, shot.id)}
        >
          {localize('com_movie_generate')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => onReview(sceneId, shot.id, 'approve')}
        >
          {localize('com_movie_approve')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => onReview(sceneId, shot.id, 'reject')}
        >
          {localize('com_movie_reject')}
        </Button>
      </div>
      {shot.lastJobId && (
        <p className="text-text-secondary col-span-full text-[11px]">
          {projectId} · {shot.lastJobId}
        </p>
      )}
    </div>
  );
}

function SceneCard({
  scene,
  projectId,
  busy,
  onPlan,
  onAudio,
  onGenerate,
  onReview,
}: {
  scene: TMovieScene;
  projectId: string;
  busy: boolean;
  onPlan: (sceneId: string) => void;
  onAudio: (sceneId: string) => void;
  onGenerate: (sceneId: string, shotId: string) => void;
  onReview: (sceneId: string, shotId: string, decision: 'approve' | 'reject') => void;
}) {
  const localize = useLocalize();
  return (
    <section className="border-border-light bg-surface-primary rounded-xl border">
      <header className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-text-primary text-sm font-semibold">
            {scene.number}. {scene.title}
          </h3>
          <p className="text-text-secondary mt-0.5 text-xs">{scene.slugline}</p>
          <p className="text-text-secondary mt-1 max-w-3xl text-xs">{scene.synopsis}</p>
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" onClick={() => onPlan(scene.id)} disabled={busy}>
            {localize('com_movie_plan_shots')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onAudio(scene.id)} disabled={busy}>
            {localize('com_movie_audio_plan')}
          </Button>
        </div>
      </header>
      {scene.shots.length === 0 ? (
        <p className="text-text-secondary px-4 pb-4 text-xs">{localize('com_movie_no_shots')}</p>
      ) : (
        <div>
          {scene.shots.map((shot) => (
            <ShotRow
              key={shot.id}
              shot={shot}
              sceneId={scene.id}
              projectId={projectId}
              busy={busy}
              onGenerate={onGenerate}
              onReview={onReview}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function JobList({ jobs }: { jobs: TMovieJob[] }) {
  const localize = useLocalize();
  const recent = useMemo(() => [...jobs].reverse().slice(0, 8), [jobs]);
  if (recent.length === 0) {
    return null;
  }
  return (
    <section className="border-border-light bg-surface-primary rounded-xl border p-4">
      <h3 className="text-text-primary text-sm font-semibold">{localize('com_movie_jobs')}</h3>
      <ul className="mt-2 space-y-2">
        {recent.map((job) => (
          <li key={job.id} className="text-text-secondary text-xs">
            <span className="text-text-primary font-medium">{job.kind}</span> · {job.state} ·{' '}
            {job.checkpoint}
            {job.errorCode ? ` · ${job.errorCode}` : ''}
            {job.errorMessage ? ` — ${job.errorMessage}` : ''}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function MovieView() {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState('');

  const projectsQuery = useQuery({
    queryKey: [QueryKeys.movieProjects],
    queryFn: () => dataService.listMovieProjects(),
  });

  const servicesQuery = useQuery({
    queryKey: [QueryKeys.movieStatus],
    queryFn: () => dataService.getMovieServiceStatus(),
    refetchOnWindowFocus: false,
  });

  const projects = projectsQuery.data ?? [];

  useEffect(() => {
    if (!selectedId && projects.length > 0) {
      setSelectedId(projects[0].id);
    }
  }, [projects, selectedId]);

  const projectQuery = useQuery({
    queryKey: [QueryKeys.movieProject, selectedId],
    queryFn: () => dataService.getMovieProject(selectedId ?? ''),
    enabled: Boolean(selectedId),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: [QueryKeys.movieProjects] });
    if (selectedId) {
      void queryClient.invalidateQueries({ queryKey: [QueryKeys.movieProject, selectedId] });
    }
  };

  const seed = useMutation({
    mutationFn: () => dataService.seedMovieProject(),
    onSuccess: (result) => {
      setSelectedId(result.project.id);
      invalidate();
    },
  });

  const create = useMutation({
    mutationFn: () => dataService.createMovieProject({ title }),
    onSuccess: (project) => {
      setTitle('');
      setSelectedId(project.id);
      invalidate();
    },
  });

  const planScene = useMutation({
    mutationFn: (sceneId: string) => dataService.planMovieScene(selectedId ?? '', sceneId),
    onSuccess: invalidate,
  });

  const generate = useMutation({
    mutationFn: ({ sceneId, shotId }: { sceneId: string; shotId: string }) =>
      dataService.generateMovieShot(selectedId ?? '', sceneId, shotId),
    onSuccess: invalidate,
  });

  const review = useMutation({
    mutationFn: ({
      sceneId,
      shotId,
      decision,
    }: {
      sceneId: string;
      shotId: string;
      decision: 'approve' | 'reject';
    }) => dataService.reviewMovieShot(selectedId ?? '', sceneId, shotId, decision),
    onSuccess: invalidate,
  });

  const audio = useMutation({
    mutationFn: (sceneId: string) => dataService.planMovieSceneAudio(selectedId ?? '', sceneId),
    onSuccess: invalidate,
  });

  const assembly = useMutation({
    mutationFn: () => dataService.planMovieAssembly(selectedId ?? ''),
    onSuccess: invalidate,
  });

  const status = useMutation({
    mutationFn: (next: TMovieProject['status']) =>
      dataService.updateMovieProject(selectedId ?? '', { status: next }),
    onSuccess: invalidate,
  });

  const busy =
    planScene.isLoading ||
    generate.isLoading ||
    review.isLoading ||
    audio.isLoading ||
    assembly.isLoading ||
    status.isLoading;

  const project = projectQuery.data;
  const mutError =
    seed.error ||
    create.error ||
    planScene.error ||
    generate.error ||
    review.error ||
    audio.error ||
    assembly.error ||
    status.error;
  const blockedJob = project?.jobs.filter((job) => job.state === 'blocked').slice(-1)[0];

  return (
    <div className="bg-surface-primary-alt text-text-primary flex h-full min-h-0 flex-col overflow-auto">
      <header className="border-border-light bg-surface-primary border-b px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-text-primary text-base font-semibold">
              {localize('com_movie_title')}
            </h1>
            <p className="text-text-secondary text-xs">{localize('com_movie_subtitle')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {servicesQuery.data?.services.map((service) => (
              <span
                key={service.service}
                className="bg-surface-tertiary text-text-secondary rounded px-2 py-1 text-[11px]"
              >
                {service.service}: {serviceLabel(service)}
              </span>
            ))}
            <Button
              size="sm"
              variant="outline"
              onClick={() => seed.mutate()}
              disabled={seed.isLoading}
            >
              {localize('com_movie_seed')}
            </Button>
          </div>
        </div>
        <p className="text-text-secondary mt-1 text-[11px]">{localize('com_movie_owner_note')}</p>
      </header>

      <div className="grid min-h-0 flex-1 gap-4 p-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="space-y-3">
          <section className="border-border-light bg-surface-primary rounded-xl border p-3">
            <h2 className="text-text-primary text-sm font-semibold">
              {localize('com_movie_projects')}
            </h2>
            {projectsQuery.isLoading ? (
              <div className="flex justify-center py-4">
                <Spinner />
              </div>
            ) : projects.length === 0 ? (
              <p className="text-text-secondary mt-2 text-xs">{localize('com_movie_no_projects')}</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {projects.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      className={`w-full rounded px-2 py-1.5 text-left text-xs ${
                        entry.id === selectedId
                          ? 'bg-surface-tertiary text-text-primary'
                          : 'text-text-secondary hover:bg-surface-hover-alt'
                      }`}
                      onClick={() => setSelectedId(entry.id)}
                    >
                      <span className="block font-medium">{entry.title}</span>
                      <span className="block text-[11px]">{entry.status}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 border-t border-border-light pt-3">
              <label className="text-text-secondary text-[11px]" htmlFor="movie-title">
                {localize('com_movie_project_name')}
              </label>
              <input
                id="movie-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="border-border-medium bg-surface-secondary text-text-primary mt-1 w-full rounded border px-2 py-1.5 text-xs"
              />
              <Button
                size="sm"
                className="mt-2 w-full"
                disabled={!title.trim() || create.isLoading}
                onClick={() => create.mutate()}
              >
                {localize('com_movie_create')}
              </Button>
            </div>
          </section>
        </aside>

        <main className="min-w-0 space-y-3">
          {!selectedId ? (
            <p className="text-text-secondary text-sm">{localize('com_movie_select_project')}</p>
          ) : projectQuery.isLoading ? (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : project ? (
            <>
              <section className="border-border-light bg-surface-primary rounded-xl border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-text-primary text-lg font-semibold">{project.title}</h2>
                    <p className="text-text-secondary mt-1 max-w-3xl text-xs">{project.logline}</p>
                    <p className="text-text-secondary mt-1 text-[11px]">
                      {project.genre} · {project.ratingTarget} · {project.aspectRatio} ·{' '}
                      {localize('com_movie_revision')} {project.revision}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label={localize('com_movie_production_status')}
                      value={project.status}
                      onChange={(event) =>
                        status.mutate(event.target.value as TMovieProject['status'])
                      }
                      className="border-border-medium bg-surface-secondary text-text-primary rounded border px-2 py-1 text-xs"
                    >
                      <option value="development">development</option>
                      <option value="production">production</option>
                      <option value="review">review</option>
                      <option value="complete">complete</option>
                    </select>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => assembly.mutate()}
                      disabled={busy}
                    >
                      {localize('com_movie_assembly_plan')}
                    </Button>
                  </div>
                </div>
                {blockedJob && (
                  <div className="border-border-light bg-surface-secondary mt-3 rounded border p-2">
                    <p className="text-text-destructive text-xs font-medium">
                      {localize('com_movie_blocked')}: {blockedJob.errorCode}
                    </p>
                    <p className="text-text-secondary mt-0.5 text-[11px]">
                      {blockedJob.errorMessage}. {localize('com_movie_blocked_note')}
                    </p>
                  </div>
                )}
                {mutError && (
                  <p className="text-text-destructive mt-2 text-xs">
                    {(mutError as Error).message}
                  </p>
                )}
              </section>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {([
                  ['scenes', project.scenes.length],
                  ['shots', project.scenes.reduce((sum, scene) => sum + scene.shots.length, 0)],
                  ['jobs', project.jobs.length],
                  ['characters', project.characters.length],
                ] as Array<[string, number]>).map(([label, value]) => (
                  <div
                    key={String(label)}
                    className="border-border-light bg-surface-primary rounded-xl border p-3"
                  >
                    <p className="text-text-secondary text-[11px]">{label}</p>
                    <p className="text-text-primary text-lg font-semibold">{value}</p>
                  </div>
                ))}
              </div>

              {project.scenes.length === 0 ? (
                <p className="text-text-secondary text-sm">{localize('com_movie_no_scenes')}</p>
              ) : (
                project.scenes.map((scene) => (
                  <SceneCard
                    key={scene.id}
                    scene={scene}
                    projectId={project.id}
                    busy={busy}
                    onPlan={(sceneId) => planScene.mutate(sceneId)}
                    onAudio={(sceneId) => audio.mutate(sceneId)}
                    onGenerate={(sceneId, shotId) => generate.mutate({ sceneId, shotId })}
                    onReview={(sceneId, shotId, decision) =>
                      review.mutate({ sceneId, shotId, decision })
                    }
                  />
                ))
              )}

              <JobList jobs={project.jobs} />
            </>
          ) : (
            <p className="text-text-secondary text-sm">{localize('com_movie_select_project')}</p>
          )}
        </main>
      </div>
    </div>
  );
}

export default MovieView;
