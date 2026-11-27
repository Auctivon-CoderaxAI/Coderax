import { useEffect, useId, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@coderax/client';
import {
  MAX_RESEARCH_CLAIM_LENGTH,
  MAX_RESEARCH_SOURCES_PER_CLAIM,
  RESEARCH_CLAIM_STATUSES,
} from 'coderax-data-provider';
import type { TResearchClaim, TResearchClaimStatus, TResearchSource } from 'coderax-data-provider';
import { CLAIM_STATUS_LABEL_KEYS } from './labels';
import { useLocalize } from '~/hooks';
import { newResearchId } from './id';

const FIELD_CLASS =
  'border-border-light bg-surface-primary text-text-primary placeholder:text-text-tertiary focus-visible:ring-ring-primary mt-1.5 w-full rounded-xl border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none';

type ClaimFormProps = {
  sources: TResearchSource[];
  disabled: boolean;
  /** Resolves true once the dossier with this claim has been persisted. */
  onAdd: (claim: TResearchClaim) => Promise<boolean>;
};

export default function ClaimForm({ sources, disabled, onAdd }: ClaimFormProps) {
  const localize = useLocalize();
  const textId = useId();
  const statusId = useId();
  const [text, setText] = useState('');
  const [status, setStatus] = useState<TResearchClaimStatus>('supported');
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  /* A removed source must not survive as an invisible citation in the draft. */
  useEffect(() => {
    setSourceIds((current) => {
      const available = new Set(sources.map((source) => source.id));
      const next = current.filter((sourceId) => available.has(sourceId));
      return next.length === current.length ? current : next;
    });
  }, [sources]);

  const toggleSource = (sourceId: string, checked: boolean) => {
    setSourceIds((current) => {
      if (checked) {
        return current.includes(sourceId)
          ? current
          : [...current, sourceId].slice(0, MAX_RESEARCH_SOURCES_PER_CLAIM);
      }
      return current.filter((value) => value !== sourceId);
    });
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) {
      setError(localize('com_research_claim_text_required'));
      return;
    }
    setError(null);
    const currentSourceIds = sourceIds.filter((sourceId) =>
      sources.some((source) => source.id === sourceId),
    );
    setPending(true);
    let saved = false;
    try {
      saved = await onAdd({
        id: newResearchId(),
        text: trimmed,
        status,
        sourceIds: currentSourceIds,
      });
    } finally {
      setPending(false);
    }
    if (!saved) {
      return;
    }
    setText('');
    setStatus('supported');
    setSourceIds([]);
  };

  return (
    <form
      onSubmit={submit}
      className="border-border-light bg-surface-primary mt-4 space-y-3 rounded-xl border p-4"
      aria-labelledby="research-claim-form-title"
    >
      <h3 id="research-claim-form-title" className="text-text-primary text-sm font-medium">
        {localize('com_research_claim_add_title')}
      </h3>
      <div>
        <label htmlFor={textId} className="text-text-primary block text-xs font-medium">
          {localize('com_research_claim_text_label')}
        </label>
        <textarea
          id={textId}
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={MAX_RESEARCH_CLAIM_LENGTH}
          rows={2}
          placeholder={localize('com_research_claim_text_placeholder')}
          className={`${FIELD_CLASS} resize-y py-2 leading-6`}
          aria-invalid={Boolean(error) || undefined}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={statusId} className="text-text-primary block text-xs font-medium">
            {localize('com_research_claim_status_label')}
          </label>
          <select
            id={statusId}
            value={status}
            onChange={(event) => setStatus(event.target.value as TResearchClaimStatus)}
            className={`${FIELD_CLASS} h-9`}
          >
            {RESEARCH_CLAIM_STATUSES.map((value) => (
              <option key={value} value={value}>
                {localize(CLAIM_STATUS_LABEL_KEYS[value])}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset className="min-w-0">
        <legend className="text-text-primary text-xs font-medium">
          {localize('com_research_claim_citations_label')}
        </legend>
        {sources.length === 0 ? (
          <p className="text-text-tertiary mt-1.5 text-xs">
            {localize('com_research_claim_no_sources')}
          </p>
        ) : (
          <div className="border-border-light mt-1.5 max-h-40 space-y-1 overflow-y-auto rounded-xl border p-2">
            {sources.map((source) => (
              <label
                key={source.id}
                className="text-text-secondary hover:bg-surface-hover flex cursor-pointer items-start gap-2 rounded-lg px-1.5 py-1 text-xs leading-5"
              >
                <input
                  type="checkbox"
                  className="focus-visible:ring-ring-primary border-border-light mt-0.5 size-3.5 shrink-0 rounded focus-visible:ring-2 focus-visible:outline-none"
                  checked={sourceIds.includes(source.id)}
                  onChange={(event) => toggleSource(source.id, event.target.checked)}
                />
                <span className="min-w-0 truncate">{source.title}</span>
              </label>
            ))}
          </div>
        )}
        <p className="text-text-tertiary mt-1 text-xs">
          {localize('com_research_claim_citations_hint', { 0: MAX_RESEARCH_SOURCES_PER_CLAIM })}
        </p>
      </fieldset>

      {error ? (
        <p className="text-text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <Button
        type="submit"
        variant="outline"
        disabled={disabled || pending || sources.length === 0}
      >
        <Plus className="size-4" aria-hidden="true" />
        {pending ? localize('com_research_saving') : localize('com_research_claim_add')}
      </Button>
    </form>
  );
}
