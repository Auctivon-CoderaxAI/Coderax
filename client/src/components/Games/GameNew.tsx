import { useId, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@coderax/client';
import { Link, useNavigate } from 'react-router-dom';
import {
  GAME_TEMPLATES,
  MAX_GAME_NAME_LENGTH,
  MAX_GAME_SUMMARY_LENGTH,
} from 'coderax-data-provider';
import { useCreateGameProjectMutation } from '~/data-provider';
import { GENRE_LABEL_KEYS } from './labels';
import { useLocalize } from '~/hooks';

export default function GameNew() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const nameId = useId();
  const summaryId = useId();
  const templateId = useId();
  const createProject = useCreateGameProjectMutation();
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [template, setTemplate] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError(localize('com_games_name_required'));
      return;
    }
    setError(null);
    createProject.mutate(
      {
        name: trimmed,
        summary: summary.trim(),
        templateId: template || undefined,
      },
      {
        onSuccess: (project) => navigate(`/games/${project._id}`),
        onError: () => setError(localize('com_games_create_error')),
      },
    );
  };

  return (
    <main className="bg-surface-primary h-full min-h-0 w-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8 md:py-8">
        <Link
          to="/games"
          className="text-text-secondary hover:text-text-primary focus-visible:ring-ring-primary inline-flex items-center gap-2 rounded-lg text-sm focus-visible:ring-2 focus-visible:outline-none"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {localize('com_games_back')}
        </Link>
        <h1 className="text-text-primary mt-3 text-2xl font-semibold tracking-tight md:text-3xl">
          {localize('com_games_new_title')}
        </h1>
        <p className="text-text-secondary mt-1 text-sm leading-6">
          {localize('com_games_new_subtitle')}
        </p>

        <form
          onSubmit={submit}
          className="border-border-light bg-surface-secondary mt-6 space-y-5 rounded-2xl border p-5"
        >
          <div>
            <label htmlFor={nameId} className="text-text-primary block text-sm font-medium">
              {localize('com_games_name_label')}
            </label>
            <input
              id={nameId}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (error) {
                  setError(null);
                }
              }}
              maxLength={MAX_GAME_NAME_LENGTH}
              placeholder={localize('com_games_name_placeholder')}
              className="border-border-light bg-surface-primary text-text-primary placeholder:text-text-tertiary focus-visible:ring-ring-primary mt-1.5 h-10 w-full rounded-xl border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none"
              aria-invalid={Boolean(error) || undefined}
            />
          </div>

          <div>
            <label htmlFor={summaryId} className="text-text-primary block text-sm font-medium">
              {localize('com_games_summary_label')}
            </label>
            <textarea
              id={summaryId}
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              maxLength={MAX_GAME_SUMMARY_LENGTH}
              rows={3}
              placeholder={localize('com_games_summary_placeholder')}
              className="border-border-light bg-surface-primary text-text-primary placeholder:text-text-tertiary focus-visible:ring-ring-primary mt-1.5 w-full resize-y rounded-xl border px-3 py-2 text-sm leading-6 focus-visible:ring-2 focus-visible:outline-none"
            />
            <p className="text-text-tertiary mt-1 text-right text-xs">
              {summary.length}/{MAX_GAME_SUMMARY_LENGTH}
            </p>
          </div>

          <div>
            <label htmlFor={templateId} className="text-text-primary block text-sm font-medium">
              {localize('com_games_template_label')}
            </label>
            <select
              id={templateId}
              value={template}
              onChange={(event) => setTemplate(event.target.value)}
              className="border-border-light bg-surface-primary text-text-primary focus-visible:ring-ring-primary mt-1.5 h-10 w-full rounded-xl border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none"
            >
              <option value="">{localize('com_games_template_blank')}</option>
              {GAME_TEMPLATES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} — {localize(GENRE_LABEL_KEYS[item.genre])}
                </option>
              ))}
            </select>
            <p className="text-text-tertiary mt-1 text-xs">{localize('com_games_template_hint')}</p>
          </div>

          {error ? (
            <p className="text-text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex items-center gap-2">
            <Button type="submit" variant="default" disabled={createProject.isLoading}>
              {createProject.isLoading
                ? localize('com_games_creating')
                : localize('com_games_create')}
            </Button>
            <Button type="button" variant="outline" onClick={() => navigate('/games')}>
              {localize('com_games_cancel')}
            </Button>
          </div>
        </form>
      </div>
    </main>
  );
}
