import { useCallback } from 'react';
import { useSetRecoilState } from 'recoil';
import { Constants } from 'coderax-data-provider';
import { useMessageContext, useShareContext } from '~/Providers';
import { useLocalize } from '~/hooks';
import store from '~/store';

/**
 * Mirrors `SUGGEST_FOLLOWUPS_TOOL` in `packages/api/src/agents/followups.ts`. The
 * client cannot import backend code, so the string is duplicated for the same
 * reason `ask_user_question` and `write_todos` are: the part dispatch and the
 * card key on one name.
 */
export const SUGGEST_FOLLOWUPS_TOOL = 'suggest_followups';

export interface FollowupSuggestion {
  label: string;
  prompt: string;
}

/** Collapses model-authored whitespace; a chip is one paragraph, not a note. */
function collapse(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/**
 * Parse a `suggest_followups` call's args into chips. Returns `null` while the
 * args are still streaming (partial JSON never parses) and for a list that fails
 * validation, so the caller can fall back to the generic row rather than render
 * a half-written or empty suggestion set.
 *
 * De-duplication mirrors `normalizeFollowups` on the server, and it has to
 * happen here too: the card renders from the model's raw args, not from the
 * normalized result the tool returned, so the same direction twice would put
 * two chips on one React key.
 */
export function parseFollowupArgs(
  args: string | Record<string, unknown> | undefined,
): FollowupSuggestion[] | null {
  if (args == null) {
    return null;
  }
  let parsed: unknown = args;
  if (typeof args === 'string') {
    if (args.trim().length === 0) {
      return null;
    }
    try {
      parsed = JSON.parse(args);
    } catch {
      return null;
    }
  }
  if (typeof parsed !== 'object' || parsed === null || !('suggestions' in parsed)) {
    return null;
  }
  const rawSuggestions = (parsed as { suggestions?: unknown }).suggestions;
  if (!Array.isArray(rawSuggestions) || rawSuggestions.length === 0) {
    return null;
  }
  const seen = new Set<string>();
  const suggestions: FollowupSuggestion[] = [];
  for (const entry of rawSuggestions) {
    if (typeof entry !== 'object' || entry === null) {
      return null;
    }
    const { label, prompt } = entry as { label?: unknown; prompt?: unknown };
    if (typeof label !== 'string' || label.trim().length === 0) {
      return null;
    }
    if (typeof prompt !== 'string' || prompt.trim().length === 0) {
      return null;
    }
    const normalizedPrompt = collapse(prompt);
    const dedupeKey = normalizedPrompt.toLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    suggestions.push({ label: collapse(label), prompt: normalizedPrompt });
  }
  return suggestions.length > 0 ? suggestions : null;
}

/**
 * Next-step chips under the reply. A click puts the full prompt in the composer
 * instead of sending it: the chips exist so the reader can pick a direction, and
 * letting them edit first keeps a one-year-old suggestion from spending a model
 * call they did not read.
 *
 * `pendingComposerTextByConvoId` is the app's existing route into the composer —
 * it focuses the textarea, appends when the reader has already typed something,
 * and is in memory only, so clicking never writes an unsent draft to storage.
 */
export default function FollowupSuggestions({
  args,
}: {
  args: string | Record<string, unknown> | undefined;
}) {
  const localize = useLocalize();
  const { conversationId } = useMessageContext();
  const { isSharedConvo } = useShareContext();
  const setPendingComposerText = useSetRecoilState(
    store.pendingComposerTextByConvoId(conversationId ?? Constants.NEW_CONVO),
  );

  const insertPrompt = useCallback(
    (prompt: string) => setPendingComposerText(prompt),
    [setPendingComposerText],
  );

  const suggestions = parseFollowupArgs(args);
  /** A shared transcript has no composer to put text into, so the chips would be
   *  dead controls there — the reply itself is the whole payload. */
  if (isSharedConvo || suggestions == null || suggestions.length === 0) {
    return null;
  }

  return (
    <div
      className="mb-3 flex w-full flex-col gap-2"
      data-testid="followup-suggestions"
      role="group"
      aria-label={localize('com_ui_suggested_followups')}
    >
      <span className="text-text-secondary text-xs font-medium">
        {localize('com_ui_suggested_followups')}
      </span>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion.prompt}
            type="button"
            title={suggestion.prompt}
            onClick={() => insertPrompt(suggestion.prompt)}
            className="border-border-light bg-surface-secondary text-text-primary hover:bg-surface-hover focus-visible:ring-text-primary max-w-full cursor-pointer rounded-full border px-3 py-1.5 text-left text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-hidden"
          >
            <span className="line-clamp-2 [overflow-wrap:anywhere]">{suggestion.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
