import { memo, useCallback } from 'react';
import { useRecoilState } from 'recoil';
import { TooltipAnchor } from '@coderax/client';
import { ChevronDown, Search } from 'lucide-react';
import ChatFilterMenu from '~/components/Conversations/ChatFilterMenu';
import { useLocalize } from '~/hooks';
import store from '~/store';

/**
 * The sidebar's top row: the Coderax wordmark and the two actions that belong
 * to the history panel. The filter menu sits here rather than beside the
 * Recents heading so the heading stays a quiet label, as in the approved
 * design, and the search icon reveals the field only when it is wanted.
 */
function BrandHeader() {
  const localize = useLocalize();
  const [search, setSearch] = useRecoilState(store.search);

  const toggleSearch = useCallback(() => {
    setSearch((current) => ({ ...current, enabled: !current.enabled }));
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement>('[data-testid="nav-search-input"]')?.focus();
    });
  }, [setSearch]);

  return (
    <div className="flex h-14 shrink-0 items-center gap-2 px-3">
      <a
        href="/c/new"
        aria-label={localize('com_ui_coderax_brand')}
        className="focus-visible:ring-text-primary flex min-w-0 items-center gap-2.5 rounded-lg outline-hidden focus-visible:ring-2 focus-visible:ring-inset"
      >
        <span className="text-text-primary truncate text-xl font-semibold tracking-tight">
          {localize('com_ui_coderax_brand')}
        </span>
        <ChevronDown className="text-text-secondary size-4 shrink-0" aria-hidden="true" />
      </a>
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <ChatFilterMenu />
        <TooltipAnchor
          description={localize('com_nav_search_placeholder')}
          render={
            <button
              type="button"
              aria-label={localize('com_nav_search_placeholder')}
              aria-pressed={search.enabled === true}
              data-testid="sidebar-search-toggle"
              onClick={toggleSearch}
              className="text-text-secondary hover:bg-surface-hover hover:text-text-primary focus-visible:ring-text-primary flex size-8 items-center justify-center rounded-md outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-inset"
            >
              <Search className="size-4" aria-hidden="true" />
            </button>
          }
        />
      </div>
    </div>
  );
}

export default memo(BrandHeader);
