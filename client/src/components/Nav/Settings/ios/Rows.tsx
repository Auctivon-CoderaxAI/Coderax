import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '~/utils';

/** One grouped card, the iOS table shape: rounded rows, hairline separators. */
export function Group({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'bg-surface-secondary divide-border-light divide-y overflow-hidden rounded-2xl',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A row that opens a page, optionally showing its current value on the right. */
export function NavRow({
  label,
  description,
  value,
  icon,
  onClick,
  testId,
}: {
  label: string;
  description?: string;
  value?: ReactNode;
  icon?: ReactNode;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="hover:bg-surface-hover focus-visible:ring-border-xheavy flex min-h-12 w-full items-center gap-3 px-4 py-3 text-left transition-colors focus-visible:ring-2 focus-visible:outline-hidden focus-visible:ring-inset"
    >
      {icon != null && <span className="text-text-primary shrink-0">{icon}</span>}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-text-primary text-base leading-5">{label}</span>
        {description != null && (
          <span className="text-text-secondary text-xs leading-4">{description}</span>
        )}
      </span>
      {value != null && (
        <span className="text-text-secondary max-w-[45%] shrink-0 truncate text-base">{value}</span>
      )}
      <ChevronRight className="text-text-tertiary size-4 shrink-0" aria-hidden="true" />
    </button>
  );
}

/** A non-navigating row holding a preference control in place of the chevron. */
export function SettingRow({ children }: { children: ReactNode }) {
  return <div className="flex min-h-12 items-center px-4 py-3 text-base">{children}</div>;
}
