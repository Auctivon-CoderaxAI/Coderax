import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { JSX } from 'react/jsx-runtime';
import { matchSorter } from 'match-sorter';
import type { KeyboardEvent, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from './Dialog';
import { cn } from '~/utils';

export interface CommandPaletteItem {
  /** Stable across renders; the active row is tracked by this, not by index. */
  id: string;
  title: string;
  /** Heading the row sits under, e.g. `Recent`, `Modules`, `Settings`. */
  group: string;
  /** Scope or kind: `Project · Aurora`, `Workspace`. */
  subtitle?: string;
  icon?: LucideIcon;
  /** Extra words this row answers to, beyond its title and subtitle. */
  keywords?: string[];
  /**
   * Set when the destination exists but cannot be opened. The row stays in the list,
   * dimmed and unselectable, because hiding it makes the platform look smaller than
   * it is — and an owner who cannot find `Film` assumes it was removed.
   */
  unavailableReason?: string;
  trailing?: ReactNode;
  onSelect: () => void;
  /** Bound to ⌘⏎; falls back to `onSelect` when absent. */
  onInspect?: () => void;
}

export interface CommandPaletteLabels {
  /** Dialog name, read by screen readers. */
  title: string;
  placeholder: string;
  empty: string;
  /** Prefix announced before an unavailable row's reason. */
  unavailable: string;
  navigate: string;
  open: string;
  close: string;
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Ranked by the caller before it reaches the palette; filtering happens here. */
  items: CommandPaletteItem[];
  labels: CommandPaletteLabels;
  /** Register ⌘K / Ctrl-K as a toggle. Mount one palette per window. */
  shortcut?: boolean;
  className?: string;
}

interface CommandGroup {
  name: string;
  items: CommandPaletteItem[];
}

/**
 * Universal navigation: every module, object, action and setting the caller supplies,
 * addressable by name. It is the palette, not global search — it answers "take me
 * there" with a destination, while `/search` answers "find everything about" with a
 * corpus. Merging the two makes both worse.
 *
 * The caller owns the sources and the ranking; this owns query, keyboard and the list
 * semantics. Unavailable rows are shown with their blocker and skipped by the
 * keyboard, so ⌘K can never strand focus on a row that does nothing.
 */
export default function CommandPalette({
  open,
  onOpenChange,
  items,
  labels,
  shortcut = true,
  className,
}: CommandPaletteProps): JSX.Element {
  const baseId = useId();
  const listId = `${baseId}-list`;
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const optionRefs = useRef(new Map<string, HTMLDivElement>());

  const matches = useMemo(() => {
    const trimmed = query.trim();
    if (trimmed === '') {
      return items;
    }
    return matchSorter(items, trimmed, { keys: ['title', 'subtitle', 'keywords'] });
  }, [items, query]);

  const groups = useMemo<CommandGroup[]>(() => {
    const byName = new Map<string, CommandPaletteItem[]>();
    for (const item of matches) {
      const existing = byName.get(item.group);
      if (existing != null) {
        existing.push(item);
      } else {
        byName.set(item.group, [item]);
      }
    }
    return Array.from(byName, ([name, groupItems]) => ({ name, items: groupItems }));
  }, [matches]);

  const selectable = useMemo(
    () => matches.filter((item) => item.unavailableReason == null),
    [matches],
  );

  /** Filtering can shrink the list under the cursor; clamp rather than reset. */
  const safeIndex = selectable.length === 0 ? -1 : Math.min(activeIndex, selectable.length - 1);
  const activeItem = safeIndex === -1 ? undefined : selectable[safeIndex];

  const optionIndexById = useMemo(() => {
    const map = new Map<string, number>();
    matches.forEach((item, index) => map.set(item.id, index));
    return map;
  }, [matches]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setActiveIndex(0);
  }, [open]);

  useEffect(() => {
    if (!open || activeItem == null) {
      return;
    }
    optionRefs.current.get(activeItem.id)?.scrollIntoView({ block: 'nearest' });
  }, [open, activeItem]);

  useEffect(() => {
    if (!shortcut) {
      return;
    }
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.altKey || event.shiftKey) {
        return;
      }
      if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey)) {
        return;
      }
      event.preventDefault();
      onOpenChange(!open);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange, shortcut]);

  const select = (item: CommandPaletteItem, inspect: boolean): void => {
    if (item.unavailableReason != null) {
      return;
    }
    const action = inspect ? (item.onInspect ?? item.onSelect) : item.onSelect;
    action();
    onOpenChange(false);
  };

  const move = (delta: number): void => {
    if (selectable.length === 0) {
      return;
    }
    setActiveIndex((current) => {
      const from = Math.min(current, selectable.length - 1);
      return (from + delta + selectable.length) % selectable.length;
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(Math.max(selectable.length - 1, 0));
      return;
    }
    if (event.key === 'Enter' && activeItem != null) {
      event.preventDefault();
      select(activeItem, event.metaKey || event.ctrlKey);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className={cn('gap-0 overflow-hidden p-0 pb-0 sm:max-w-xl', className)}
      >
        <DialogTitle className="sr-only">{labels.title}</DialogTitle>

        <div className="border-border-light flex items-center gap-2 border-b px-4 py-3">
          <Search className="text-text-tertiary size-4 shrink-0" aria-hidden={true} />
          <input
            role="combobox"
            aria-expanded={true}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              activeItem == null
                ? undefined
                : `${baseId}-option-${optionIndexById.get(activeItem.id) ?? 0}`
            }
            aria-label={labels.placeholder}
            placeholder={labels.placeholder}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
            className={cn(
              'text-text-primary placeholder:text-text-tertiary min-w-0 flex-1 bg-transparent text-sm',
              'focus:outline-hidden',
            )}
          />
        </div>

        <div
          id={listId}
          role="listbox"
          aria-label={labels.title}
          className="max-h-[60vh] overflow-y-auto p-1.5"
        >
          {matches.length === 0 && (
            <div className="text-text-secondary px-4 py-8 text-center text-sm">{labels.empty}</div>
          )}

          {groups.map((group, groupIndex) => {
            const headingId = `${baseId}-group-${groupIndex}`;
            return (
              <div key={group.name} role="group" aria-labelledby={headingId}>
                <div
                  id={headingId}
                  className="text-text-tertiary px-2 pt-2 pb-1 text-xs font-medium"
                >
                  {group.name}
                </div>

                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isUnavailable = item.unavailableReason != null;
                  const isActive = item.id === activeItem?.id;
                  const optionIndex = optionIndexById.get(item.id) ?? 0;

                  return (
                    <div
                      key={item.id}
                      id={`${baseId}-option-${optionIndex}`}
                      ref={(node) => {
                        if (node == null) {
                          optionRefs.current.delete(item.id);
                        } else {
                          optionRefs.current.set(item.id, node);
                        }
                      }}
                      role="option"
                      /* Options are reached through the input's
                         aria-activedescendant, so they stay out of the tab order but
                         must be programmatically focusable. */
                      tabIndex={-1}
                      aria-selected={isActive}
                      aria-disabled={isUnavailable || undefined}
                      onMouseMove={() => {
                        if (isUnavailable) {
                          return;
                        }
                        const index = selectable.findIndex((entry) => entry.id === item.id);
                        if (index !== -1) {
                          setActiveIndex(index);
                        }
                      }}
                      onClick={() => select(item, false)}
                      className={cn(
                        'rounded-theme-control flex cursor-pointer items-center gap-2.5 px-2 py-2 text-sm',
                        isActive ? 'bg-surface-hover text-text-primary' : 'text-text-secondary',
                        isUnavailable && 'cursor-not-allowed opacity-60',
                      )}
                    >
                      {Icon != null && <Icon className="size-4 shrink-0" aria-hidden={true} />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{item.title}</span>
                        {item.subtitle != null && item.subtitle !== '' && (
                          <span className="text-text-tertiary block truncate text-xs">
                            {item.subtitle}
                          </span>
                        )}
                        {isUnavailable && (
                          <span className="text-status-warning block text-xs">
                            <span className="sr-only">{labels.unavailable}: </span>
                            {item.unavailableReason}
                          </span>
                        )}
                      </span>
                      {item.trailing}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div className="text-text-tertiary border-border-light flex items-center gap-4 border-t px-4 py-2 text-xs">
          <span>
            <kbd className="border-border-light bg-surface-secondary text-text-secondary rounded border px-1 font-sans">
              ↑↓
            </kbd>{' '}
            {labels.navigate}
          </span>
          <span>
            <kbd className="border-border-light bg-surface-secondary text-text-secondary rounded border px-1 font-sans">
              ⏎
            </kbd>{' '}
            {labels.open}
          </span>
          <span>
            <kbd className="border-border-light bg-surface-secondary text-text-secondary rounded border px-1 font-sans">
              Esc
            </kbd>{' '}
            {labels.close}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
