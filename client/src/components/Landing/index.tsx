import { Nav, Footer } from './Chrome';
import { Hero } from './Hero';
import { Features, HowItWorks, Security, Faq } from './sections';
import { useTheme } from './useTheme';

/**
 * Standalone marketing page for Coderax. It renders outside the authenticated
 * shell (no Recoil, no data-provider) and mounts at /welcome, so it cannot
 * disturb the chat application's state or routing.
 */
export default function LandingPage() {
  const { theme, toggle } = useTheme();

  return (
    <div
      className={`${theme === 'dark' ? 'dark' : ''} min-h-screen bg-[#fbfcf7] text-[#12140f] dark:bg-[#08090a] dark:text-[#f4f6ef]`}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-[#16180f] focus:px-4 focus:py-2 focus:text-sm focus:text-[#f4f6ef] dark:focus:bg-[#b6f24a] dark:focus:text-[#0c0e08]"
      >
        Skip to content
      </a>
      <Nav theme={theme} onToggle={toggle} />
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
