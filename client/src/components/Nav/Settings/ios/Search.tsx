import { useMemo } from 'react';
import type { SettingsContextValue } from '../types';
import type { IosPageId } from './pages';
import { Group, NavRow } from './Rows';
import { searchPages } from './pages';
import { useLocalize } from '~/hooks';

/** Rows named in a result subtitle before the list is cut short. */
const MAX_LABELS = 2;

function summarize(labels: string[], fallback?: string): string | undefined {
  if (labels.length === 0) {
    return fallback;
  }
  const shown = labels.slice(0, MAX_LABELS).join(', ');
  return labels.length > MAX_LABELS ? `${shown}…` : shown;
}

/**
 * Mobile search results: one row per page that matches, so picking a result
 * opens that page instead of dropping an isolated control into the list.
 */
export default function SearchResults({
  ctx,
  query,
  onOpen,
}: {
  ctx: SettingsContextValue;
  query: string;
  onOpen: (page: IosPageId) => void;
}) {
  const localize = useLocalize();
  const results = useMemo(() => searchPages(query, ctx, localize), [query, ctx, localize]);

  if (results.length === 0) {
    return (
      <p className="text-text-secondary p-2 text-sm">{localize('com_ui_settings_no_results')}</p>
    );
  }

  return (
    <div aria-label={localize('com_ui_settings_results_aria')} aria-live="polite">
      <Group>
        {results.map(({ page, matches }) => (
          <NavRow
            key={page.id}
            testId={`ios-search-result-${page.id}`}
            icon={page.icon}
            label={localize(page.labelKey)}
            description={summarize(
              matches.map((match) => match.label),
              page.descriptionKey != null ? localize(page.descriptionKey) : undefined,
            )}
            onClick={() => onOpen(page.id)}
          />
        ))}
      </Group>
    </div>
  );
}
