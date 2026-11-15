import { Skeleton } from '@coderax/client';
import { getMessageRowWidthClass } from './ui/MessageRow';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

type SkeletonTurn = { side: 'user' | 'agent'; lines: string[] };

/** A short exchange, enough to fill the first screen without implying a length. */
const turns: SkeletonTurn[] = [
  { side: 'user', lines: ['w-48'] },
  { side: 'agent', lines: ['w-full', 'w-11/12', 'w-3/4'] },
  { side: 'user', lines: ['w-64'] },
  { side: 'agent', lines: ['w-full', 'w-5/6', 'w-full', 'w-2/3'] },
];

/**
 * Placeholder for a conversation whose messages are still loading. It keeps the
 * message column's width and top padding (see `MessagesView` and `MessageRow`),
 * so the real transcript replaces it in place instead of shifting sideways.
 */
export default function TranscriptSkeleton({
  fullWidth = false,
  hasProjectBadge = false,
}: {
  fullWidth?: boolean;
  /** Exposed as a data attribute only. The `pt-9` offset under `ProjectBadge`
   *  is applied by the `data-chat-pane` container in `ChatView`, which wraps
   *  both this skeleton and `MessagesView`; adding it here would double it. */
  hasProjectBadge?: boolean;
}) {
  const localize = useLocalize();
  const widthClass = getMessageRowWidthClass({ fullWidth });

  return (
    <div
      className="relative flex-1 overflow-hidden"
      data-testid="transcript-skeleton"
      data-project-badge={hasProjectBadge || undefined}
    >
      {/* Skeleton rows are decorative, so a live region carries the announcement */}
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {localize('com_ui_loading')}
      </span>
      <div className="scrollbar-gutter-stable flex flex-col gap-6 pt-14 pb-9" aria-hidden="true">
        {turns.map((turn, index) => (
          <div
            key={index}
            className={cn(
              'mx-auto flex min-w-0',
              turn.side === 'user' ? 'justify-end' : 'items-start',
              widthClass,
            )}
          >
            {turn.side === 'user' ? (
              <Skeleton
                className={cn('rounded-theme-surface rounded-br-theme-control h-10', turn.lines[0])}
              />
            ) : (
              <div className="flex w-full flex-col gap-2">
                <div className="mb-1 flex min-h-7 items-center gap-2">
                  <Skeleton className="size-6 rounded-full" />
                  <Skeleton className="h-4 w-24" />
                </div>
                {turn.lines.map((width, line) => (
                  <Skeleton key={line} className={cn('h-4', width)} />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}