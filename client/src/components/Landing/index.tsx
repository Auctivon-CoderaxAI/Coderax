import { useContext } from 'react';
import { ThemeContext } from '@coderax/client';
import { Nav, Footer } from './Chrome';
import { Hero } from './Hero';
import { Features, HowItWorks, Security, Faq } from './sections';

/**
 * Standalone marketing page for Coderax. It renders outside the authenticated
 * shell (no Recoil, no data-provider) and mounts at /welcome, so it cannot
 * disturb the chat application's state or routing. Colors come from the
 * deployment theme, so high-contrast and branded themes apply here too.
 */
export default function LandingPage() {
  const { resolvedMode, setTheme } = useContext(ThemeContext);
  const toggle = () => setTheme(resolvedMode === 'dark' ? 'light' : 'dark');

  return (
    <div className="min-h-screen bg-surface-primary text-text-primary">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-button-primary focus:px-4 focus:py-2 focus:text-sm focus:text-text-inverted"
      >
        Skip to content
      </a>
      <Nav mode={resolvedMode} onToggle={toggle} />
      <main id="main">
        <Hero />
        <Features />
        <HowItWorks />
        <Security />
        <Faq />
      </main>
      <Footer />
    </div>
  );
}
