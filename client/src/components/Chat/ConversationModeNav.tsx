import type { StoredConversationMode } from './mode';
import { useConversationMode } from './mode';

type ConversationModeNavProps = {
  active?: StoredConversationMode;
  labels: {
    ariaLabel: string;
    chat: string;
    work: string;
  };
};

const segmentClassName =
  'flex min-w-[5rem] items-center justify-center rounded-full px-6 py-2 text-sm transition-colors';
const selectedClassName = `${segmentClassName} bg-surface-tertiary text-text-primary shadow-sm`;
const idleClassName = `${segmentClassName} text-text-secondary hover:text-text-primary`;

export default function ConversationModeNav({ active, labels }: ConversationModeNavProps) {
  const { mode, setMode } = useConversationMode();
  const selected = normaliseMode(active ?? mode) ?? 'chat';
  return (
    <nav
      aria-label={labels.ariaLabel}
      className="border-border-light bg-surface-primary-alt flex items-center gap-1 rounded-full border p-1 shadow-sm"
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
        aria-pressed={selected === 'code' || selected === 'work'}
        className={selected === 'code' || selected === 'work' ? selectedClassName : idleClassName}
      >
        {labels.work}
      </button>
    </nav>
  );
}
