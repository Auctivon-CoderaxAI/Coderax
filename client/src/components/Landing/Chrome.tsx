import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import type { ThemeMode } from '@coderax/client';
import { nav, brand, footer } from './content';
import { ButtonLink, focusRing } from './primitives';

function Wordmark() {
  return (
    <Link
      to="/welcome"
      className={clsx('group flex items-center gap-2.5 rounded-full', focusRing)}
      aria-label={`${brand.name} home`}
    >
      <span className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-button-primary">
        <span className="h-2.5 w-2.5 rounded-full bg-accent-primary" />
      </span>
      <span className="text-base font-semibold tracking-tight text-text-primary">
        {brand.name}
      </span>
    </Link>
  );
}

function ThemeToggle({ mode, onToggle }: { mode: ThemeMode; onToggle: () => void }) {
  const next = mode === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={`Switch to ${next} mode`}
      className={clsx(
        'flex h-9 w-9 items-center justify-center rounded-full border border-border-medium text-text-secondary transition-colors hover:bg-surface-hover touch:size-theme-control-touch',
        focusRing,
      )}
    >
      {mode === 'dark' ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.8 6.8 0 0 0 9.8 9.8Z" />
        </svg>
      )}
    </button>
  );
}

export function Nav({ mode, onToggle }: { mode: ThemeMode; onToggle: () => void }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border-light bg-surface-primary/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-6 px-5 sm:px-8">
        <Wordmark />
        <nav aria-label="Sections" className="hidden items-center gap-7 md:flex">
          {nav.links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={clsx(
                'text-sm font-medium text-text-secondary transition-colors hover:text-text-primary',
                focusRing,
              )}
            >
              {link.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle mode={mode} onToggle={onToggle} />
          <ButtonLink href={nav.signIn.href} variant="ghost" className="hidden sm:inline-flex">
            {nav.signIn.label}
          </ButtonLink>
          <ButtonLink href={nav.cta.href}>{nav.cta.label}</ButtonLink>
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-border-light">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-14 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <Wordmark />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-text-secondary">
            {footer.blurb}
          </p>
        </div>
        {footer.columns.map((column) => (
          <div key={column.title}>
            <h3 className="text-xs font-semibold uppercase tracking-widest text-text-tertiary">
              {column.title}
            </h3>
            <ul className="mt-4 space-y-2.5">
              {column.links.map((link) => (
                <li key={link.href}>
                  <Link
                    to={link.href}
                    className={clsx(
                      'text-sm text-text-secondary transition-colors hover:text-text-primary',
                      focusRing,
                    )}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto w-full max-w-6xl border-t border-border-light px-5 py-6 text-xs text-text-tertiary sm:px-8">
        {footer.legal}
      </div>
    </footer>
  );
}
