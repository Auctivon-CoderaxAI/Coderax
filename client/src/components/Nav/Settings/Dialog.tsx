import { useEffect, useState } from 'react';
import { useAtom } from 'jotai';
import * as Tabs from '@radix-ui/react-tabs';
import { X, ChevronLeft, Search } from 'lucide-react';
import { SettingsTabValues } from 'coderax-data-provider';
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from '@headlessui/react';
import {
  Button,
  DialogLayer,
  useMediaQuery,
  useRemScale,
  DIALOG_SCRIM_CLASS,
} from '@coderax/client';
import type { TDialogProps } from '~/common';
import type { IosPageId } from './ios/pages';
import type { SettingsTab } from './types';
import { IOS_PAGES, findPage, pageVisible } from './ios/pages';
import { useSettingsContext } from './context';
import { settingsTabAtom } from './state';
import SearchResults from './ios/Search';
import { useLocalize } from '~/hooks';
import Overview from './ios/Overview';
import PageContent from './ios/Page';
import Sidebar from './Sidebar';
import Content from './Content';
import { TABS } from './types';
import { cn } from '~/utils';

export default function SettingsDialog({ open, onOpenChange }: TDialogProps) {
  const localize = useLocalize();
  const ctx = useSettingsContext();
  /** The panel is laid out in rem, so the two-column switch has to compare the
   *  viewport in the same units: a fixed 768px breakpoint picks the side-by-side
   *  layout at scales where the scaled sidebar leaves the content pane too narrow. */
  const remScale = useRemScale();
  const isSmallScreen = useMediaQuery(`(max-width: ${767 * remScale}px)`);
  const [activeTab, setActiveTab] = useState<SettingsTab>(SettingsTabValues.GENERAL);
  const [iosPage, setIosPage] = useState<IosPageId | null>(null);
  const [requestedTab, setRequestedTab] = useAtom(settingsTabAtom);
  const [query, setQuery] = useState('');

  const searching = query.trim().length > 0;
  const visibleTabs = TABS.filter((t) => !t.show || t.show(ctx));
  const effectiveTab = visibleTabs.some((t) => t.id === activeTab)
    ? activeTab
    : SettingsTabValues.GENERAL;
  const requestedPage = iosPage != null ? findPage(iosPage) : undefined;
  const effectiveIosPage =
    requestedPage != null && pageVisible(requestedPage, ctx) ? requestedPage : undefined;

  useEffect(() => {
    if (!requestedTab) {
      return;
    }
    if (visibleTabs.some((t) => t.id === requestedTab)) {
      setActiveTab(requestedTab as SettingsTab);
      if (isSmallScreen) {
        const page = IOS_PAGES.filter((candidate) => pageVisible(candidate, ctx)).find(
          (candidate) => candidate.sources.some((source) => source.tab === requestedTab),
        );
        if (page != null) {
          setIosPage(page.id);
        }
      }
    }
    setRequestedTab(null);
  }, [requestedTab, setRequestedTab, visibleTabs, isSmallScreen, ctx]);

  const selectTab = (tab: SettingsTab) => {
    setActiveTab(tab);
  };

  /** Results stand in for the open page, so the header keeps the index title (and
   *  no back control) until a result opens the page it belongs to. */
  const openPage = searching ? undefined : effectiveIosPage;
  const mobileTitle = openPage != null ? localize(openPage.labelKey) : localize('com_nav_settings');

  const openSearchResult = (id: IosPageId) => {
    setIosPage(id);
    setQuery('');
  };

  let mobileBody = (
    <Overview
      ctx={ctx}
      onOpen={setIosPage}
      onClose={() => onOpenChange(false)}
      onQueryChange={setQuery}
    />
  );
  if (searching) {
    mobileBody = <SearchResults ctx={ctx} query={query} onOpen={openSearchResult} />;
  } else if (effectiveIosPage != null) {
    mobileBody = <PageContent page={effectiveIosPage} ctx={ctx} />;
  }

  return (
    <Transition appear show={open}>
      <Dialog as="div" className="relative z-50" onClose={() => onOpenChange(false)}>
        <TransitionChild
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className={cn('fixed inset-0', DIALOG_SCRIM_CLASS)} aria-hidden="true" />
        </TransitionChild>
        <TransitionChild
          enter="ease-out duration-200"
          enterFrom="opacity-0 scale-95"
          enterTo="opacity-100 scale-100"
          leave="ease-in duration-100"
          leaveFrom="opacity-100 scale-100"
          leaveTo="opacity-0 scale-95"
        >
          <div
            className={cn(
              'fixed inset-0 flex w-screen items-center justify-center',
              isSmallScreen ? 'p-0' : 'p-4',
            )}
          >
            <DialogPanel
              className={cn(
                /** Headless UI panel, so it bypasses the shared dialog primitives
                 *  and needs the contrast edge declared here. `shadow-2xl` is a
                 *  black shadow with nothing to separate against on a black canvas. */
                'border-border-light high-contrast:border high-contrast:border-solid high-contrast:border-border-medium high-contrast:shadow-none flex flex-col overflow-hidden border-(length:--theme-dialog-stroke)',
                isSmallScreen
                  ? 'bg-surface-primary-alt h-full max-h-none w-full'
                  : 'bg-surface-dialog rounded-theme-surface h-[85vh] w-[56.25rem] max-w-[calc(100vw-4rem)] shadow-2xl',
              )}
            >
              <DialogTitle
                as="div"
                className={cn(
                  'border-border-inset flex items-center justify-between border-b',
                  isSmallScreen ? 'h-14 shrink-0 px-2' : 'p-5',
                )}
              >
                {isSmallScreen ? (
                  <div className="grid w-full grid-cols-[2.5rem_1fr_2.5rem] items-center">
                    {openPage != null ? (
                      <button
                        type="button"
                        onClick={() => {
                          setIosPage(null);
                          setQuery('');
                        }}
                        className="text-text-primary hover:bg-surface-hover focus:ring-border-xheavy flex h-10 w-10 items-center justify-center rounded-full transition-colors focus:ring-2 focus:outline-hidden"
                        aria-label={localize('com_ui_back')}
                      >
                        <ChevronLeft className="h-6 w-6" aria-hidden="true" />
                      </button>
                    ) : (
                      <span aria-hidden="true" />
                    )}
                    <h2 className="text-text-primary truncate text-center text-lg font-semibold">
                      {mobileTitle}
                    </h2>
                    <button
                      type="button"
                      onClick={() => onOpenChange(false)}
                      aria-label={localize('com_ui_close_settings')}
                      className="text-text-secondary hover:bg-surface-hover hover:text-text-primary focus:ring-border-xheavy ml-auto flex h-10 w-10 items-center justify-center rounded-full transition-colors focus:ring-2 focus:outline-hidden"
                    >
                      <X className="h-5 w-5" aria-hidden="true" />
                    </button>
                  </div>
                ) : (
                  <>
                    <h2 className="text-text-primary text-lg font-medium">
                      {localize('com_nav_settings')}
                    </h2>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onOpenChange(false)}
                      aria-label={localize('com_ui_close_settings')}
                      className="text-text-secondary hover:bg-surface-hover hover:text-text-primary focus:ring-border-xheavy h-auto w-auto rounded-lg p-1 transition-colors focus:ring-2"
                    >
                      <X className="h-5 w-5" aria-hidden="true" />
                    </Button>
                  </>
                )}
              </DialogTitle>
              {/* A Headless UI panel, so it counts itself as a dialog level for the popovers its
                  settings open (Select lists, menus, tooltips) to layer above it. */}
              <DialogLayer>
                {isSmallScreen ? (
                  <div className="flex min-h-0 flex-1 flex-col">
                    <div className="relative shrink-0 px-4 pt-3 pb-2">
                      <Search
                        className="text-text-tertiary pointer-events-none absolute top-1/2 left-6 h-4 w-4 -translate-y-1/2"
                        aria-hidden="true"
                      />
                      <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={localize('com_ui_settings_search_placeholder')}
                        aria-label={localize('com_ui_settings_search_placeholder')}
                        className="bg-surface-secondary text-text-primary w-full rounded-xl py-2.5 pr-8 pl-9 text-base focus-visible:outline-hidden"
                      />
                      {query.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setQuery('')}
                          aria-label={localize('com_ui_clear_search')}
                          className="text-text-secondary hover:bg-surface-hover hover:text-text-primary focus-visible:ring-text-primary absolute top-1/2 right-5 -translate-y-1/2 rounded-md p-1 transition-colors focus-visible:ring-2 focus-visible:outline-hidden"
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto px-4">{mobileBody}</div>
                  </div>
                ) : (
                  <Tabs.Root
                    value={effectiveTab}
                    onValueChange={(v) => setActiveTab(v as SettingsTab)}
                    orientation="vertical"
                    className="flex min-h-0 flex-1 flex-row gap-6 overflow-hidden p-5"
                  >
                    <Sidebar
                      ctx={ctx}
                      query={query}
                      onQueryChange={setQuery}
                      onSelectTab={selectTab}
                      showChevron={false}
                      hideTabs={false}
                      stacked={false}
                    />
                    <div className="flex-1 overflow-y-auto pr-1">
                      {searching ? (
                        <Content activeTab={effectiveTab} query={query} ctx={ctx} />
                      ) : (
                        <Tabs.Content
                          value={effectiveTab}
                          tabIndex={-1}
                          className="focus:outline-hidden"
                        >
                          <Content activeTab={effectiveTab} query={query} ctx={ctx} />
                        </Tabs.Content>
                      )}
                    </div>
                  </Tabs.Root>
                )}
              </DialogLayer>
            </DialogPanel>
          </div>
        </TransitionChild>
      </Dialog>
    </Transition>
  );
}
