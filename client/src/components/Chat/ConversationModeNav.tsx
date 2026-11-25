import type { StoredConversationMode } from './mode';
import { normaliseMode, useConversationMode } from './mode';

type ConversationModeNavProps = {
  active?: StoredConversationMode;
  labels: {
    ariaLabel: string;
    chat: string;
    work: string;
  };
};

/** The approved shell puts a wide two-segment switch at the top centre. */
const segmentClassName =
  'flex h-10 min-w-[8rem] items-center justify-center rounded-full px-6 text-sm font-semibold transition-colors';
const selectedClassName = `${segmentClassName} bg-surface-tertiary text-text-primary`;
const idleClassName = `${segmentClassName} text-text-secondary hover:text-text-primary`;

export default function ConversationModeNav({ active, labels }: ConversationModeNavProps) {
  const { mode, setMode } = useConversationMode();
  const selected = normaliseMode(active ?? mode) ?? 'chat';
  return (
    <nav
      aria-label={labels.ariaLabel}
      className="bg-surface-secondary flex items-center gap-0.5 rounded-full p-0.5"
    >
      <button
        type="button"
        onClick={() => setMode('chat')}
        aria-pressed={selected === 'chat'}
        className={selected === 'chat' ? selectedClassName : idleClassName}
      >
        {labels.chat}
      </button>
      <button
        type="button"
        onClick={() => setMode('code')}
        aria-pressed={selected === 'code'}
        className={selected === 'code' ? selectedClassName : idleClassName}
      >
        {labels.work}
      </button>
    </nav>
  );
}
