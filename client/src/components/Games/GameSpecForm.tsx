import { useId, useState } from 'react';
import { Button } from '@coderax/client';
import {
  GAME_CAMERAS,
  GAME_GENRES,
  MAX_GAME_PROMPT_LENGTH,
  MAX_GAME_SPEC_FIELD_LENGTH,
} from 'coderax-data-provider';
import type { TGameProject, TGameSpec } from 'coderax-data-provider';
import { CAMERA_LABEL_KEYS, GENRE_LABEL_KEYS } from './labels';
import { useSaveGameSpecMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';

const DEFAULT_SPEC: TGameSpec = {
  prompt: '',
  genre: 'platformer',
  camera: 'side_view',
  players: 1,
  coreLoop: '',
  winCondition: '',
  artDirection: '',
};

type SaveStatus = 'idle' | 'saved' | 'error' | 'conflict' | 'invalid';

const STATUS_CLASS: Record<SaveStatus, string> = {
  idle: 'text-text-tertiary text-sm',
  saved: 'text-text-secondary text-sm',
  error: 'text-text-destructive text-sm',
  conflict: 'text-text-destructive text-sm',
  invalid: 'text-text-destructive text-sm',
};

const responseStatus = (error: unknown): number | undefined =>
  (error as { response?: { status?: number } } | null)?.response?.status;

const textFieldClass =
  'border-border-light bg-surface-primary text-text-primary placeholder:text-text-tertiary focus-visible:ring-ring-primary mt-1.5 w-full rounded-xl border px-3 py-2 text-sm leading-6 focus-visible:ring-2 focus-visible:outline-none';

export default function GameSpecForm({ project }: { project: TGameProject }) {
  const localize = useLocalize();
  const promptId = useId();
  const genreId = useId();
  const cameraId = useId();
  const playersId = useId();
  const coreLoopId = useId();
  const winConditionId = useId();
  const artDirectionId = useId();
  const saveSpec = useSaveGameSpecMutation();
  const [draft, setDraft] = useState<TGameSpec>(project.spec ?? DEFAULT_SPEC);
  const [status, setStatus] = useState<SaveStatus>('idle');

  const update = <Key extends keyof TGameSpec>(key: Key, value: TGameSpec[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    if (status !== 'idle') {
      setStatus('idle');
    }
  };

  const statusMessage = (() => {
    switch (status) {
      case 'saved':
        return localize('com_games_save_saved', { 0: project.specRevision });
      case 'invalid':
        return localize('com_games_prompt_required');
      case 'conflict':
        return localize('com_games_save_conflict');
      case 'error':
        return localize('com_games_save_error');
      default:
        return localize('com_games_save_hint');
    }
  })();

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.prompt.trim()) {
      setStatus('invalid');
      return;
    }
    saveSpec.mutate(
      {
        gameId: project._id,
        spec: { ...draft, prompt: draft.prompt.trim() },
        expectedRevision: project.revision,
      },
      {
        onSuccess: () => setStatus('saved'),
        onError: (error) => setStatus(responseStatus(error) === 409 ? 'conflict' : 'error'),
      },
    );
  };

  return (
    <form onSubmit={submit} className="space-y-5" aria-busy={saveSpec.isLoading}>
      <div>
        <label htmlFor={promptId} className="text-text-primary block text-sm font-medium">
          {localize('com_games_prompt_label')}
        </label>
        <textarea
          id={promptId}
          value={draft.prompt}
          onChange={(event) => update('prompt', event.target.value)}
          rows={4}
          maxLength={MAX_GAME_PROMPT_LENGTH}
          placeholder={localize('com_games_prompt_placeholder')}
          className={textFieldClass}
          aria-invalid={status === 'invalid' || undefined}
          required
        />
        <p className="text-text-tertiary mt-1 text-right text-xs">
          {draft.prompt.length}/{MAX_GAME_PROMPT_LENGTH}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor={genreId} className="text-text-primary block text-sm font-medium">
            {localize('com_games_genre_label')}
          </label>
          <select
            id={genreId}
            value={draft.genre}
            onChange={(event) => update('genre', event.target.value as TGameSpec['genre'])}
            className={textFieldClass}
          >
            {GAME_GENRES.map((genre) => (
              <option key={genre} value={genre}>
                {localize(GENRE_LABEL_KEYS[genre])}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={cameraId} className="text-text-primary block text-sm font-medium">
            {localize('com_games_camera_label')}
          </label>
          <select
            id={cameraId}
            value={draft.camera}
            onChange={(event) => update('camera', event.target.value as TGameSpec['camera'])}
            className={textFieldClass}
          >
            {GAME_CAMERAS.map((camera) => (
              <option key={camera} value={camera}>
                {localize(CAMERA_LABEL_KEYS[camera])}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={playersId} className="text-text-primary block text-sm font-medium">
            {localize('com_games_players_label')}
          </label>
          <select
            id={playersId}
            value={draft.players}
            onChange={(event) => update('players', Number(event.target.value) === 2 ? 2 : 1)}
            className={textFieldClass}
          >
            <option value={1}>{localize('com_games_players_solo')}</option>
            <option value={2}>{localize('com_games_players_two')}</option>
          </select>
        </div>
      </div>

      <div>
        <label htmlFor={coreLoopId} className="text-text-primary block text-sm font-medium">
          {localize('com_games_core_loop_label')}
        </label>
        <textarea
          id={coreLoopId}
          value={draft.coreLoop}
          onChange={(event) => update('coreLoop', event.target.value)}
          rows={2}
          maxLength={MAX_GAME_SPEC_FIELD_LENGTH}
          className={textFieldClass}
        />
      </div>

      <div>
        <label htmlFor={winConditionId} className="text-text-primary block text-sm font-medium">
          {localize('com_games_win_condition_label')}
        </label>
        <textarea
          id={winConditionId}
          value={draft.winCondition}
          onChange={(event) => update('winCondition', event.target.value)}
          rows={2}
          maxLength={MAX_GAME_SPEC_FIELD_LENGTH}
          className={textFieldClass}
        />
      </div>

      <div>
        <label htmlFor={artDirectionId} className="text-text-primary block text-sm font-medium">
          {localize('com_games_art_direction_label')}
        </label>
        <textarea
          id={artDirectionId}
          value={draft.artDirection}
          onChange={(event) => update('artDirection', event.target.value)}
          rows={2}
          maxLength={MAX_GAME_SPEC_FIELD_LENGTH}
          className={textFieldClass}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="default" disabled={saveSpec.isLoading}>
          {saveSpec.isLoading ? localize('com_games_saving') : localize('com_games_save_spec')}
        </Button>
        <p className={STATUS_CLASS[status]} role={status === 'idle' ? undefined : 'status'}>
          {statusMessage}
        </p>
      </div>
    </form>
  );
}
