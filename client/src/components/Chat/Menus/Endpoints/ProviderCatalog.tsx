import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useGetProviderCatalogQuery } from 'coderax-data-provider/react-query';
import { PROVIDER_CATALOG_FILTERS, matchesProviderFilter } from 'coderax-data-provider';
import type {
  ProviderCatalogFilter,
  ProviderCatalogModel,
  ProviderCatalogResponse,
  ProviderCatalogStatus,
} from 'coderax-data-provider';
import { CustomMenuItem } from './CustomMenu';
import { useLocalize } from '~/hooks';

type Row =
  | { kind: 'provider'; status: ProviderCatalogStatus }
  | { kind: 'model'; model: ProviderCatalogModel };

const filterLabels = {
  all: 'com_providers_filter_all',
  available: 'com_providers_filter_available',
  free: 'com_providers_filter_free',
  reasoning: 'com_providers_filter_reasoning',
  tools: 'com_providers_filter_tools',
  work: 'com_providers_filter_work',
} as const satisfies Record<ProviderCatalogFilter, string>;

export type ProviderCatalogProps = {
  onSelect: (model: ProviderCatalogModel) => void;
  initialFilter?: ProviderCatalogFilter;
};

function contextLabel(tokens: number | null): string | null {
  if (tokens == null) return null;
  if (tokens >= 1_000_000) return `${Math.round(tokens / 1_000_000)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}

function useReasonLabel() {
  const localize = useLocalize();
  return (reason: string): string => {
    switch (reason) {
      case 'credential_missing':
        return localize('com_providers_reason_credential_missing');
      case 'credential_rejected':
        return localize('com_providers_reason_credential_rejected');
      case 'provider_unreachable':
        return localize('com_providers_reason_provider_unreachable');
      case 'nonzero_price':
        return localize('com_providers_reason_nonzero_price');
      case 'pricing_unverified':
        return localize('com_providers_reason_pricing_unverified');
      case 'account_allowance_unverified':
        return localize('com_providers_reason_account_allowance');
      case 'model_inactive':
        return localize('com_providers_reason_model_inactive');
      default:
        return localize('com_providers_reason_unavailable');
    }
  };
}

/** Flatten providers and their models into rows for the virtualizer. */
export function buildCatalogRows(
  catalog: ProviderCatalogResponse | undefined,
  filter: ProviderCatalogFilter,
  query: string,
): Row[] {
  if (!catalog) return [];
  const needle = query.trim().toLowerCase();
  const rows: Row[] = [];
  for (const status of catalog.providers) {
    const models = catalog.models.filter(
      (model) =>
        model.provider === status.provider &&
        matchesProviderFilter(model, filter) &&
        (needle === '' ||
          model.id.toLowerCase().includes(needle) ||
          model.label.toLowerCase().includes(needle)),
    );
    if (models.length === 0) continue;
    rows.push({ kind: 'provider', status });
    for (const model of models) rows.push({ kind: 'model', model });
  }
  return rows;
}

export default function ProviderCatalog({ onSelect, initialFilter = 'all' }: ProviderCatalogProps) {
  const localize = useLocalize();
  const reasonLabel = useReasonLabel();
  const [filter, setFilter] = useState<ProviderCatalogFilter>(initialFilter);
  const [query, setQuery] = useState('');
  const catalog = useGetProviderCatalogQuery();
  const rows = useMemo(
    () => buildCatalogRows(catalog.data, filter, query),
    [catalog.data, filter, query],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 44,
    getItemKey: (index) => {
      const row = rows[index];
      return row.kind === 'provider'
        ? `provider:${row.status.provider}`
        : `model:${row.model.provider}:${row.model.id}`;
    },
    overscan: 8,
  });

  if (catalog.isLoading) {
    return (
      <div role="status" className="text-text-secondary px-3 py-2 text-sm">
        {localize('com_providers_loading')}
      </div>
    );
  }

  if (!catalog.data) {
    if (catalog.isError) {
      return (
        <div className="text-text-secondary flex items-center gap-2 px-3 py-2 text-sm">
          <span role="alert">{localize('com_providers_load_error')}</span>
          <button
            type="button"
            className="text-text-primary rounded-theme-control hover:bg-surface-hover px-2 py-1"
            onClick={() => void catalog.refetch()}
          >
            {localize('com_ui_retry')}
          </button>
        </div>
      );
    }
    return null;
  }

  return (
    <div className="border-border-chrome mt-1 border-t pt-1" data-testid="provider-catalog">
      <div
        className="flex flex-wrap gap-1 px-2 pb-1"
        role="group"
        aria-label={localize('com_providers_filters')}
      >
        {PROVIDER_CATALOG_FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={
              filter === value
                ? 'bg-surface-active-alt text-text-primary rounded-theme-control px-2 py-0.5 text-xs'
                : 'text-text-secondary hover:bg-surface-hover rounded-theme-control px-2 py-0.5 text-xs'
            }
          >
            {localize(filterLabels[value])}
          </button>
        ))}
      </div>
      <div className="px-2 pb-1">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={localize('com_providers_search')}
          placeholder={localize('com_providers_search')}
          className="border-border-chrome bg-presentation text-text-primary rounded-theme-control w-full border px-2 py-1 text-sm"
        />
      </div>
      <div
        ref={scrollRef}
        className="max-h-72 overflow-y-auto"
        role="group"
        aria-label={localize('com_providers_catalog')}
      >
        <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            if (!row) return null;
            return (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className="absolute top-0 left-0 w-full"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                {row.kind === 'provider' ? (
                  <div className="text-text-secondary flex items-center justify-between px-3 py-1 text-xs font-medium">
                    <span>{row.status.label}</span>
                    <span data-testid={`provider-summary-${row.status.provider}`}>
                      {`${localize('com_providers_eligible')}: ${row.status.modelsEligible} / ${row.status.modelsDiscovered}`}
                    </span>
                  </div>
                ) : (
                  <ModelRow model={row.model} reasonLabel={reasonLabel} onSelect={onSelect} />
                )}
              </div>
            );
          })}
        </div>
      </div>
      {rows.length === 0 && (
        <div role="status" className="text-text-secondary px-3 py-2 text-sm">
          {localize('com_providers_empty')}
        </div>
      )}
    </div>
  );
}

function ModelRow({
  model,
  reasonLabel,
  onSelect,
}: {
  model: ProviderCatalogModel;
  reasonLabel: (reason: string) => string;
  onSelect: (model: ProviderCatalogModel) => void;
}) {
  const localize = useLocalize();
  const context = contextLabel(model.contextTokens);
  const capability = [
    context ? localize('com_providers_context', { 0: context }) : null,
    model.capabilities.reasoning ? localize('com_providers_reasoning') : null,
    model.capabilities.tools ? localize('com_providers_tools') : null,
    model.available ? localize('com_providers_free') : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const disabled = !model.available || !model.chat;
  return (
    <CustomMenuItem
      disabled={disabled}
      aria-disabled={disabled}
      title={model.available ? model.id : reasonLabel(model.reason)}
      onClick={() => {
        if (!disabled) onSelect(model);
      }}
      className="flex-col items-start gap-0 px-3 py-1 text-left"
    >
      <span className="text-text-primary w-full truncate text-sm">{model.label}</span>
      <span className="text-text-secondary w-full truncate text-xs">
        {model.id}
        {capability ? ` — ${capability}` : ''}
      </span>
      {!model.available && (
        <span
          className="text-status-error-strong text-xs"
          data-testid={`disabled-${model.provider}-${model.id}`}
        >
          {reasonLabel(model.reason)}
        </span>
      )}
    </CustomMenuItem>
  );
}
