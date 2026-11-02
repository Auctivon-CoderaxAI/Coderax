import { Link } from 'react-router-dom';
import { nav, brand, footer } from './content';
import { ButtonLink } from './primitives';
import type { Theme } from './useTheme';

function Wordmark() {
  return (
    <Link
      to="/welcome"
      className="group flex items-center gap-2.5 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7c8a6a] dark:focus-visible:ring-[#b6f24a]"
      aria-label={`${brand.name} home`}
    >
      <span className="relative flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#16180f] dark:bg-[#b6f24a]">
        <span className="h-2.5 w-2.5 rounded-full bg-[#b6f24a] dark:bg-[#0c0e08]" />
      </span>
      <span className="text-[15px] font-semibold tracking-[-0.02em] text-[#12140f] dark:text-[#f4f6ef]">
        {brand.name}
      </span>
    </Link>
  );
}

function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={`Switch to ${next} mode`}
      className="flex h-9 w-9 items-center justify-center rounded-full border border-[#d8dccd] text-[#4d5545] transition-colors hover:bg-[#f2f4ea] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7c8a6a] dark:border-white/15 dark:text-[#c2ccb7] dark:hover:bg-white/5 dark:focus-visible:ring-[#b6f24a]"
    >
      {theme === 'dark' ? (
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

export function Nav({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  return (
    <header className="sticky top-0 z-40 border-b border-[#e4e7db]/80 bg-[#fbfcf7]/85 backdrop-blur-xl dark:border-white/10 dark:bg-[#08090a]/80">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-6 px-5 sm:px-8">
        <Wordmark />
        <nav aria-label="Sections" className="hidden items-center gap-7 md:flex">
          {nav.links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-[13px] font-medium text-[#4d5545] transition-colors hover:text-[#12140f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7c8a6a] dark:text-[#a9b3a0] dark:hover:text-white dark:focus-visible:ring-[#b6f24a]"
            >
              {link.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle theme={theme} onToggle={onToggle} />
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
    <footer className="border-t border-[#e4e7db] dark:border-white/10">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-14 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <Wordmark />
          <p className="mt-4 max-w-xs text-[13px] leading-relaxed text-[#5c6650] dark:text-[#98a38f]">
            {footer.blurb}
          </p>
        </div>
        {footer.columns.map((column) => (
          <div key={column.title}>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7c8a6a] dark:text-[#8b9782]">
              {column.title}
            </h3>
            <ul className="mt-4 space-y-2.5">
              {column.links.map((link) => (
                <li key={link.href}>
                  <Link
                    to={link.href}
                    className="text-[13px] text-[#3f4739] transition-colors hover:text-[#12140f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7c8a6a] dark:text-[#b6c1ac] dark:hover:text-white dark:focus-visible:ring-[#b6f24a]"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto w-full max-w-6xl border-t border-[#e4e7db] px-5 py-6 text-[12px] text-[#6b7463] sm:px-8 dark:border-white/10 dark:text-[#8b9782]">
        {footer.legal}
      </div>
    </footer>
  );
}
