import { LockKeyhole, TriangleAlert } from 'lucide-react';
import { cn } from '~/utils';

type GameUnavailableProps = {
  title: string;
  body: string;
  /** Stable machine code shown so the block is unmistakable, e.g. 409 EXECUTOR_UNAVAILABLE. */
  code?: string;
  tone?: 'info' | 'warning';
  className?: string;
};

export default function GameUnavailable({
  title,
  body,
  code,
  tone = 'info',
  className,
}: GameUnavailableProps) {
  const Icon = tone === 'warning' ? TriangleAlert : LockKeyhole;

  return (
    <section
      className={cn(
        'border-border-light bg-surface-secondary rounded-2xl border px-5 py-5',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className="bg-surface-tertiary text-text-secondary flex size-8 shrink-0 items-center justify-center rounded-full"
          aria-hidden="true"
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 className="text-text-primary text-sm font-semibold">{title}</h2>
          <p className="text-text-secondary mt-1 text-sm leading-6 text-pretty">{body}</p>
          {code ? (
            <p className="text-text-tertiary mt-3 font-mono text-xs tracking-wide">{code}</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
