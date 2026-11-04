import { Link } from 'react-router-dom';

type ConversationMode = 'chat' | 'work';

type ConversationModeNavProps = {
  active?: ConversationMode;
  chatPath?: string;
  labels: {
    ariaLabel: string;
    chat: string;
    work: string;
  };
};

const segmentClassName =
  'flex min-w-[5.5rem] items-center justify-center rounded-full px-6 py-1.5 text-sm transition-colors';
const selectedClassName = `${segmentClassName} bg-surface-tertiary text-text-primary shadow-sm`;
const idleClassName = `${segmentClassName} text-text-secondary hover:text-text-primary`;

export default function ConversationModeNav({
  active,
  chatPath,
  labels,
}: ConversationModeNavProps) {
  return (
    <nav
      aria-label={labels.ariaLabel}
      className="border-border-light bg-surface-primary-alt flex items-center gap-1 rounded-full border p-1"
    >
      <Link
        to={chatPath ?? '/c/new'}
        aria-current={active === 'chat' ? 'page' : undefined}
        className={active === 'chat' ? selectedClassName : idleClassName}
      >
        {labels.chat}
      </Link>
      <Link
        to="/work"
        state={chatPath ? { chatPath } : undefined}
        aria-current={active === 'work' ? 'page' : undefined}
        className={active === 'work' ? selectedClassName : idleClassName}
      >
        {labels.work}
      </Link>
    </nav>
  );
}
