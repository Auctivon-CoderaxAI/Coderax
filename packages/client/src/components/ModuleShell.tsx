import { JSX } from 'react/jsx-runtime';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '~/utils';

export interface ModuleTab {
  value: string;
  label: string;
  /** Trailing detail, e.g. a count or a status dot. */
  badge?: ReactNode;
  disabled?: boolean;
}

export interface ModuleShellProps {
  /** The module's name. The shell never derives it from the route. */
  title: string;
  /** Rendered above the title — a `Breadcrumb`, a project scope, a parent object link. */
  breadcrumb?: ReactNode;
  /** Drawn beside the title. Canvas chrome icons are 20px. */
  icon?: LucideIcon;
  /** One line under the title. Omit rather than leaving an empty paragraph. */
  description?: string;
  /** The module's `CapabilityBadge`, so status sits beside the name it qualifies. */
  status?: ReactNode;
  /** Header actions, right-aligned. */
  actions?: ReactNode;
  tabs?: ModuleTab[];
  /** The tab whose panel the body is showing. */
  activeTab?: string;
  onTabChange?: (value: string) => void;
  /** Accessible name for the tab strip. Defaults to the title, which is already copy. */
  tabsLabel?: string;
  children?: ReactNode;
  /** A persistent footer: run status, counts, save state. */
  footer?: ReactNode;
  className?: string;
  bodyClassName?: string;
}

/**
 * The frame every module canvas shares: breadcrumb, title and status, actions, a tab
 * strip and a scrolling body. Forty modules that each draw their own header become
 * forty products, so the header lives here and nowhere else.
 *
 * The strip is navigation, not a tab widget: modules are route-driven and the owner
 * says which one they are on with the URL. It renders `aria-current="page"` buttons
 * instead of `role="tab"`/`role="tabpanel"` pairs, because there is no hidden panel to
 * switch between — the routed module renders the active tab's content as `children`.
 *
 * Empty, blocked and error bodies are `children` too. A planned module passes its
 * reason to `CapabilityBadge` and renders its blocked state in the body; the shell
 * deliberately offers no "empty" slot that could render a loading skeleton instead.
 */
export default function ModuleShell({
  title,
  breadcrumb,
  icon: Icon,
  description,
  status,
  actions,
  tabs,
  activeTab,
  onTabChange,
  tabsLabel,
  children,
  footer,
  className,
  bodyClassName,
}: ModuleShellProps): JSX.Element {
  return (
    <section className={cn('flex h-full min-h-0 w-full flex-col', className)}>
      <header className="shrink-0 px-4 pt-4 sm:px-6 sm:pt-5">
        {breadcrumb != null && <div className="mb-2 min-w-0">{breadcrumb}</div>}

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            {Icon != null && (
              <Icon className="text-text-secondary mt-0.5 size-5 shrink-0" aria-hidden={true} />
            )}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-text-primary font-display truncate text-xl font-semibold">
                  {title}
                </h1>
                {status}
              </div>
              {description != null && description !== '' && (
                <p className="text-text-secondary mt-1 text-sm leading-6">{description}</p>
              )}
            </div>
          </div>

          {actions != null && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      </header>

      {tabs != null && tabs.length > 0 && (
        <nav
          aria-label={tabsLabel ?? title}
          className="mt-3 shrink-0 overflow-x-auto px-4 sm:px-6"
        >
          <ul className="border-border-light -mb-px flex items-center gap-1 border-b">
            {tabs.map((tab) => {
              const isActive = tab.value === activeTab;
              return (
                <li key={tab.value}>
                  <button
                    type="button"
                    aria-current={isActive ? 'page' : undefined}
                    disabled={tab.disabled}
                    onClick={() => {
                      if (!isActive) {
                        onTabChange?.(tab.value);
                      }
                    }}
                    className={cn(
                      'duration-theme-fast inline-flex min-h-theme-target items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'border-current text-text-primary'
                        : 'text-text-secondary hover:text-text-primary border-transparent',
                      'disabled:pointer-events-none disabled:opacity-50',
                    )}
                  >
                    {tab.label}
                    {tab.badge}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      )}

      <div
        className={cn('min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6', bodyClassName)}
      >
        {children}
      </div>

      {footer != null && (
        <footer className="border-border-light shrink-0 border-t px-4 py-2 sm:px-6">
          {footer}
        </footer>
      )}
    </section>
  );
}
