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

const selectedClassName = 'rounded-md bg-surface-active px-3 py-1.5 text-text-primary';
const idleClassName = 'rounded-md px-3 py-1.5 text-text-secondary hover:bg-surface-active';

export default function ConversationModeNav({
  active,
  chatPath,
  labels,
}: ConversationModeNavProps) {
  return (
    <nav
      aria-label={labels.ariaLabel}
      className="border-border-medium bg-surface-secondary flex items-center gap-1 rounded-lg border p-1 text-xs"
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
