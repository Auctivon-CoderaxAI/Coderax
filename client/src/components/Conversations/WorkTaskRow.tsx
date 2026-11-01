import { Pin } from 'lucide-react';
import { Button } from '@coderax/client';
import type { TWorkTask } from 'coderax-data-provider';
import { useLocalize } from '~/hooks';

export const workTaskPinKey = (conversationId: string) => `work:${conversationId}`;

type WorkTaskRowProps = {
  task: TWorkTask;
  pinned: boolean;
  onSelect: () => void;
  onTogglePin?: () => void;
  pinDisabled?: boolean;
};

export default function WorkTaskRow({
  task,
  pinned,
  onSelect,
  onTogglePin,
  pinDisabled = false,
}: WorkTaskRowProps) {
  const localize = useLocalize();
  const pinLabel = localize(pinned ? 'com_ui_unpin' : 'com_ui_pin');

  return (
    <div
      className="flex min-w-0 items-center gap-1"
      data-testid={pinned ? 'pinned-work-task' : 'work-task-row'}
    >
      <Button
        variant="card"
        size="row"
        className="min-w-0 flex-1 justify-between"
        onClick={onSelect}
      >
        <span className="min-w-0 flex-1 truncate text-sm">{task.title}</span>
        <span className="text-text-secondary ml-4 shrink-0 text-xs">{task.state}</span>
      </Button>
      {onTogglePin && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9 shrink-0"
          aria-label={`${pinLabel} ${task.title}`}
          title={`${pinLabel} ${task.title}`}
          disabled={pinDisabled}
          onClick={onTogglePin}
        >
          <Pin className="icon-sm" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
