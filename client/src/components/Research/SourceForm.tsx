import { useId, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@coderax/client';
import {
  MAX_RESEARCH_EXCERPT_LENGTH,
  MAX_RESEARCH_NOTE_LENGTH,
  MAX_RESEARCH_PUBLISHER_LENGTH,
  MAX_RESEARCH_SOURCE_TITLE_LENGTH,
  MAX_RESEARCH_SOURCE_URL_LENGTH,
  RESEARCH_SOURCE_KINDS,
  researchUrlHost,
} from 'coderax-data-provider';
import type { TResearchSource, TResearchSourceKind } from 'coderax-data-provider';
import { SOURCE_KIND_LABEL_KEYS } from './labels';
import { useLocalize } from '~/hooks';
import { newResearchId } from './id';

const FIELD_CLASS =
  'border-border-light bg-surface-primary text-text-primary placeholder:text-text-tertiary focus-visible:ring-ring-primary mt-1.5 w-full rounded-xl border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none';

type SourceFormProps = {
  disabled: boolean;
  onAdd: (source: TResearchSource) => void;
};

export default function SourceForm({ disabled, onAdd }: SourceFormProps) {
  const localize = useLocalize();
  const titleId = useId();
  const urlId = useId();
  const publisherId = useId();
  const kindId = useId();
  const excerptId = useId();
  const noteId = useId();
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [publisher, setPublisher] = useState('');
  const [kind, setKind] = useState<TResearchSourceKind>('primary');
  const [excerpt, setExcerpt] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedTitle = title.trim();
    const trimmedUrl = url.trim();
    if (!trimmedTitle) {
      setError(localize('com_research_source_title_required'));
      return;
    }
    if (!researchUrlHost(trimmedUrl)) {
      setError(localize('com_research_source_url_invalid'));
      return;
    }
    setError(null);
    onAdd({
      id: newResearchId(),
      title: trimmedTitle,
      url: trimmedUrl,
      publisher: publisher.trim(),
      kind,
      excerpt: excerpt.trim(),
      note: note.trim(),
      retrievedAt: new Date().toISOString().slice(0, 10),
    });
    setTitle('');
    setUrl('');
    setPublisher('');
    setKind('primary');
    setExcerpt('');
    setNote('');
  };

  return (
    <form
      onSubmit={submit}
      className="border-border-light bg-surface-primary mt-4 space-y-3 rounded-xl border p-4"
      aria-labelledby="research-source-form-title"
    >
      <h3 id="research-source-form-title" className="text-text-primary text-sm font-medium">
        {localize('com_research_source_add_title')}
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={titleId} className="text-text-primary block text-xs font-medium">
            {localize('com_research_source_title_label')}
          </label>
          <input
            id={titleId}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={MAX_RESEARCH_SOURCE_TITLE_LENGTH}
            className={`${FIELD_CLASS} h-9`}
            aria-invalid={error === localize('com_research_source_title_required') || undefined}
          />
        </div>
        <div>
          <label htmlFor={urlId} className="text-text-primary block text-xs font-medium">
            {localize('com_research_source_url_label')}
          </label>
          <input
            id={urlId}
            type="url"
            inputMode="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            maxLength={MAX_RESEARCH_SOURCE_URL_LENGTH}
            placeholder="https://"
            className={`${FIELD_CLASS} h-9`}
            aria-invalid={error === localize('com_research_source_url_invalid') || undefined}
          />
        </div>
        <div>
          <label htmlFor={publisherId} className="text-text-primary block text-xs font-medium">
            {localize('com_research_source_publisher_label')}
          </label>
          <input
            id={publisherId}
            value={publisher}
            onChange={(event) => setPublisher(event.target.value)}
            maxLength={MAX_RESEARCH_PUBLISHER_LENGTH}
            className={`${FIELD_CLASS} h-9`}
          />
        </div>
        <div>
          <label htmlFor={kindId} className="text-text-primary block text-xs font-medium">
            {localize('com_research_source_kind_label')}
          </label>
          <select
            id={kindId}
            value={kind}
            onChange={(event) => setKind(event.target.value as TResearchSourceKind)}
            className={`${FIELD_CLASS} h-9`}
          >
            {RESEARCH_SOURCE_KINDS.map((value) => (
              <option key={value} value={value}>
                {localize(SOURCE_KIND_LABEL_KEYS[value])}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label htmlFor={excerptId} className="text-text-primary block text-xs font-medium">
          {localize('com_research_source_excerpt_label')}
        </label>
        <textarea
          id={excerptId}
          value={excerpt}
          onChange={(event) => setExcerpt(event.target.value)}
          maxLength={MAX_RESEARCH_EXCERPT_LENGTH}
          rows={2}
          placeholder={localize('com_research_source_excerpt_placeholder')}
          className={`${FIELD_CLASS} resize-y py-2 leading-6`}
        />
      </div>
      <div>
        <label htmlFor={noteId} className="text-text-primary block text-xs font-medium">
          {localize('com_research_source_note_label')}
        </label>
        <input
          id={noteId}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={MAX_RESEARCH_NOTE_LENGTH}
          placeholder={localize('com_research_source_note_placeholder')}
          className={`${FIELD_CLASS} h-9`}
        />
      </div>
      {error ? (
        <p className="text-text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="outline" disabled={disabled}>
        <Plus className="size-4" aria-hidden="true" />
        {localize('com_research_source_add')}
      </Button>
    </form>
  );
}
