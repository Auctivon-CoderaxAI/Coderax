import { useState } from 'react';
import { ArrowLeft, Gamepad2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, EmptyState } from '@coderax/client';
import { GAME_TEMPLATES } from 'coderax-data-provider';
import type { TGameTemplate } from 'coderax-data-provider';
import { useCreateGameProjectMutation } from '~/data-provider';
import { CAMERA_LABEL_KEYS, GENRE_LABEL_KEYS } from './labels';
import { useLocalize } from '~/hooks';

export default function GameTemplates() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const createProject = useCreateGameProjectMutation();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const applyTemplate = (template: TGameTemplate) => {
    setPendingId(template.id);
    setFailed(false);
    createProject.mutate(
      {
        name: template.name,
        summary: template.summary,
        templateId: template.id,
      },
      {
        onSuccess: (project) => {
          setPendingId(null);
          navigate(`/games/${project._id}`);
        },
        onError: () => {
          setPendingId(null);
          setFailed(true);
        },
      },
    );
  };

  return (
    <main className="bg-surface-primary h-full min-h-0 w-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">
        <Link
          to="/games"
          className="text-text-secondary hover:text-text-primary focus-visible:ring-ring-primary inline-flex items-center gap-2 rounded-lg text-sm focus-visible:ring-2 focus-visible:outline-none"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {localize('com_games_back')}
        </Link>
        <h1 className="text-text-primary mt-3 text-2xl font-semibold tracking-tight md:text-3xl">
          {localize('com_games_templates_title')}
        </h1>
        <p className="text-text-secondary mt-1 max-w-2xl text-sm leading-6">
          {localize('com_games_templates_subtitle')}
        </p>

        {failed ? (
          <p className="text-text-destructive mt-4 text-sm" role="alert">
            {localize('com_games_create_error')}
          </p>
        ) : null}

        <section className="mt-6">
          {GAME_TEMPLATES.length === 0 ? (
            <EmptyState icon={Gamepad2} description={localize('com_games_templates_empty')} />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {GAME_TEMPLATES.map((template) => {
                const isPending = pendingId === template.id;
                return (
                  <article
                    key={template.id}
                    className="border-border-light bg-surface-secondary flex flex-col rounded-2xl border p-5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="text-text-primary text-base font-semibold tracking-tight">
                          {template.name}
                        </h2>
                        <p className="text-text-tertiary mt-0.5 text-xs">
                          {localize(GENRE_LABEL_KEYS[template.genre])}
                          <span aria-hidden="true"> · </span>
                          {localize(CAMERA_LABEL_KEYS[template.spec.camera])}
                          <span aria-hidden="true"> · </span>
                          {template.spec.players === 1
                            ? localize('com_games_players_solo')
                            : localize('com_games_players_two')}
                        </p>
                      </div>
                      <span className="bg-surface-tertiary text-text-secondary flex size-9 shrink-0 items-center justify-center rounded-xl">
                        <Gamepad2 className="size-4" aria-hidden="true" />
                      </span>
                    </div>
                    <p className="text-text-secondary mt-3 text-sm leading-relaxed">
                      {template.summary}
                    </p>
                    <dl className="text-text-secondary mt-4 space-y-2 text-xs">
                      <div>
                        <dt className="text-text-tertiary font-medium">
                          {localize('com_games_core_loop_label')}
                        </dt>
                        <dd className="mt-0.5 leading-relaxed">{template.spec.coreLoop}</dd>
                      </div>
                      <div>
                        <dt className="text-text-tertiary font-medium">
                          {localize('com_games_win_condition_label')}
                        </dt>
                        <dd className="mt-0.5 leading-relaxed">{template.spec.winCondition}</dd>
                      </div>
                    </dl>
                    <div className="mt-4 pt-1">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={createProject.isLoading}
                        onClick={() => applyTemplate(template)}
                      >
                        {isPending
                          ? localize('com_games_template_creating')
                          : localize('com_games_template_use')}
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
        <p className="text-text-tertiary mt-6 text-xs leading-5">
          {localize('com_games_templates_footnote')}
        </p>
      </div>
    </main>
  );
}
