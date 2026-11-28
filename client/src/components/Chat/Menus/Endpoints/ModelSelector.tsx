import React, { useMemo } from 'react';
import { ChevronDown } from 'lucide-react';
import { TooltipAnchor } from '@coderax/client';
import { getConfigDefaults } from 'coderax-data-provider';
import type { ModelSelectorProps } from '~/common';
import {
  renderModelSpecs,
  renderEndpoints,
  renderSearchResults,
  renderCustomGroups,
} from './components';
import { ModelSelectorProvider, useModelSelectorContext } from './ModelSelectorContext';
import { useShortcutAriaKey, useShortcutHint } from '~/hooks/useKeyboardShortcuts';
import { ModelSelectorChatProvider } from './ModelSelectorChatContext';
import { getSelectedIcon, getDisplayValue } from './utils';
import { CustomMenu as Menu } from './CustomMenu';
import ProviderCatalog from './ProviderCatalog';
import DialogManager from './DialogManager';
import { useLocalize } from '~/hooks';

const defaultInterface = getConfigDefaults().interface;

function ModelSelectorContent({ compact = false }: { compact?: boolean }) {
  const localize = useLocalize();
  const modelSelectorHint = useShortcutHint('openModelSelector', localize('com_ui_select_model'));
  const modelSelectorAriaKey = useShortcutAriaKey('openModelSelector');

  const {
    // Coderax
    agentsMap,
    modelSpecs,
    mappedEndpoints,
    endpointsConfig,
    // State
    searchValue,
    searchResults,
    selectedValues,
    // Functions
    setSearchValue,
    setSelectedValues,
    // Dialog
    keyDialogOpen,
    onOpenChange,
    keyDialogEndpoint,
  } = useModelSelectorContext();

  const selectedIcon = useMemo(
    () =>
      getSelectedIcon({
        mappedEndpoints: mappedEndpoints ?? [],
        selectedValues,
        modelSpecs,
        endpointsConfig,
        agentsMap,
      }),
    [mappedEndpoints, selectedValues, modelSpecs, endpointsConfig, agentsMap],
  );
  const selectedDisplayValue = useMemo(
    () =>
      getDisplayValue({
        localize,
        agentsMap,
        modelSpecs,
        selectedValues,
        mappedEndpoints,
      }),
    [localize, agentsMap, modelSpecs, selectedValues, mappedEndpoints],
  );
  const hasNoAvailableModels = !mappedEndpoints?.length && !modelSpecs?.length;
  /* getDisplayValue reports the selection label when nothing resolves, so the
   * name only carries a value once the visible text differs from that label. */
  const selectionLabel = localize('com_ui_select_model');
  const selectorAccessibleName =
    selectedDisplayValue && selectedDisplayValue !== selectionLabel
      ? `${selectionLabel}: ${selectedDisplayValue}`
      : selectionLabel;

  const trigger = (
    <TooltipAnchor
      aria-label={selectorAccessibleName}
      description={modelSelectorHint}
      render={
        <button
          data-testid="model-selector-button"
          aria-keyshortcuts={modelSelectorAriaKey}
          className={
            compact
              ? 'text-text-primary hover:!bg-surface-hover flex !h-8 max-w-full items-center !justify-end !gap-1 !rounded-lg !border-0 !bg-transparent !px-1.5 !py-0 text-sm transition-colors'
              : 'border-border-chrome bg-presentation text-text-primary hover:bg-surface-active-alt rounded-theme-control my-1 flex h-9 max-w-full items-center gap-2 border px-3 py-2 text-sm'
          }
          aria-label={selectorAccessibleName}
        >
          {!compact && selectedIcon && React.isValidElement(selectedIcon) && (
            <div className="flex shrink-0 items-center justify-center overflow-hidden">
              {selectedIcon}
            </div>
          )}
          <span className="truncate text-left">{selectedDisplayValue}</span>
          {compact && (
            <ChevronDown className="text-text-secondary size-3.5 shrink-0" aria-hidden="true" />
          )}
        </button>
      }
    />
  );

  return (
    <div className="relative flex max-w-[60vw] min-w-0 flex-col items-center gap-2 sm:max-w-xs">
      <Menu
        values={selectedValues}
        onValuesChange={(values: Record<string, any>) => {
          setSelectedValues({
            endpoint: values.endpoint || '',
            model: values.model || '',
            modelSpec: values.modelSpec || '',
          });
        }}
        onSearch={(value) => setSearchValue(value)}
        combobox={
          <input
            id="model-search"
            aria-label={localize('com_endpoint_search_models')}
            placeholder=" "
          />
        }
        comboboxLabel={localize('com_endpoint_search_models')}
        trigger={trigger}
      >
        {searchResults && renderSearchResults(searchResults, localize, searchValue)}
        {!searchResults && hasNoAvailableModels && (
          <div role="status" className="text-text-secondary px-3 py-2 text-sm">
            {localize('com_endpoint_no_models_available')}
          </div>
        )}
        {!searchResults && !hasNoAvailableModels && (
          <>
            {/* Render ungrouped modelSpecs (no group field) */}
            {renderModelSpecs(
              modelSpecs?.filter((spec) => !spec.group) || [],
              selectedValues.modelSpec || '',
            )}
            {/* Render endpoints (will include grouped specs matching endpoint names) */}
            {renderEndpoints(mappedEndpoints ?? [])}
            {/* Discovered providers and models, grouped with their eligibility reasons. */}
            <ProviderCatalog
              onSelect={(endpoint, model) =>
                setSelectedValues({ endpoint, model, modelSpec: '' })
              }
            />
            {/* Render custom groups (specs with group field not matching any endpoint) */}
            {renderCustomGroups(modelSpecs || [], mappedEndpoints ?? [])}
          </>
        )}
      </Menu>
      <DialogManager
        keyDialogOpen={keyDialogOpen}
        onOpenChange={onOpenChange}
        endpointsConfig={endpointsConfig || {}}
        keyDialogEndpoint={keyDialogEndpoint || undefined}
      />
    </div>
  );
}

export default function ModelSelector({
  startupConfig,
  compact = false,
}: ModelSelectorProps & { compact?: boolean }) {
  const interfaceConfig = startupConfig?.interface ?? defaultInterface;
  const modelSpecs = startupConfig?.modelSpecs?.list ?? [];

  // Hide the selector when modelSelect is false and there are no model specs to show
  if (interfaceConfig.modelSelect === false && modelSpecs.length === 0) {
    return null;
  }

  return (
    <ModelSelectorChatProvider>
      <ModelSelectorProvider startupConfig={startupConfig}>
        <ModelSelectorContent compact={compact} />
      </ModelSelectorProvider>
    </ModelSelectorChatProvider>
  );
}
