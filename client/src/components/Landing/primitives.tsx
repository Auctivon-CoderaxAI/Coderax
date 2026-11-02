import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';

/** Reveals once, honouring reduced-motion by rendering visible from the start. */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setShown(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShown(true);
          observer.disconnect();
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.15 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={{ transitionDelay: shown ? `${delay}ms` : undefined }}
      className={clsx(
        'transition-[opacity,transform] duration-700 ease-out motion-reduce:transition-none',
        shown ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={clsx(
        'text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7c8a6a] dark:text-[#b6f24a]',
        className,
      )}
    >
      {children}
    </p>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = 'left',
}: {
  eyebrow: string;
  title: string;
  description?: string;
  align?: 'left' | 'center';
}) {
  return (
    <div className={clsx('max-w-2xl', align === 'center' && 'mx-auto text-center')}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-3 text-balance text-[clamp(1.75rem,3.2vw,2.75rem)] font-medium leading-[1.08] tracking-[-0.03em] text-[#12140f] dark:text-[#f4f6ef]">
        {title}
      </h2>
      {description ? (
        <p className="mt-4 text-pretty text-[15px] leading-relaxed text-[#4d5545] dark:text-[#a9b3a0]">
          {description}
        </p>
      ) : null}
    </div>
  );
}

const buttonBase =
  'inline-flex items-center justify-center gap-2 rounded-full text-sm font-medium transition-[background-color,border-color,color,transform] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#7c8a6a] focus-visible:ring-offset-white dark:focus-visible:ring-[#b6f24a] dark:focus-visible:ring-offset-[#08090a] active:translate-y-px';

export function ButtonLink({
  href,
  children,
  variant = 'primary',
  className,
}: {
  href: string;
  children: ReactNode;
  variant?: 'primary' | 'ghost';
  className?: string;
}) {
  const styles =
    variant === 'primary'
      ? 'bg-[#16180f] px-5 py-2.5 text-[#f4f6ef] hover:bg-[#262a1a] dark:bg-[#b6f24a] dark:text-[#0c0e08] dark:hover:bg-[#c9ff63]'
      : 'border border-[#d8dccd] px-5 py-2.5 text-[#242a1c] hover:border-[#a8b09a] hover:bg-[#f2f4ea] dark:border-white/15 dark:text-[#e8ece0] dark:hover:border-white/30 dark:hover:bg-white/5';

  // Router links keep SPA navigation and the deployment basename intact.
  const isInternal = href.startsWith('/');
  if (!isInternal) {
    return (
      <a href={href} className={clsx(buttonBase, styles, className)}>
        {children}
      </a>
    );
  }
  return (
    <Link to={href} className={clsx(buttonBase, styles, className)}>
      {children}
    </Link>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-[#d8dccd] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-[#5c6650] dark:border-white/15 dark:text-[#9aa891]">
      {children}
    </span>
  );
}
