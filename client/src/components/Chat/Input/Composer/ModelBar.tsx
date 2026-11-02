import { Cpu, Server } from 'lucide-react';
import type { TConversation } from 'coderax-data-provider';
import { cn } from '~/utils';

interface ModelBarProps {
  conversation: TConversation | null;
  className?: string;
}

/**
 * A quiet read-out of the model the next message will use. The picker itself
 * stays in the composer's action row; this strip only keeps the active model
 * and endpoint visible while the thread is scrolled away from that row.
 */
export default function ModelBar({ conversation, className }: ModelBarProps) {
  if (!conversation?.model) {
    return null;
  }

  return (
    <div
      data-testid="composer-model-bar"
      className={cn(
        'flex min-w-0 items-center gap-2 px-2 pt-2 text-xs text-text-secondary',
        'text-text-secondary flex min-w-0 items-center gap-2 px-2 pt-2 text-xs',
        className,
      )}
    >
      <Cpu className="size-3 shrink-0" aria-hidden="true" />
      <span className="truncate font-medium text-text-primary">{conversation.model}</span>
      <span className="text-text-primary truncate font-medium">{conversation.model}</span>
      {conversation.endpoint ? (
        <>
          <span aria-hidden="true">·</span>
          <Server className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{conversation.endpoint}</span>
        </>
      ) : null}
    </div>
  );
}
