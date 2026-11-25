/**
 * Chat and Work share one page geometry, so switching modes never moves the
 * header, the greeting or the composer. Work puts its own content (recent
 * tasks, agent and model selection, its policy note) in the slots Chat uses for
 * starters, composer tools and hints rather than in a layout of its own.
 */

/**
 * Overlays the top of the canvas; content scrolls beneath its fade. Three
 * columns keep the mode switch on the canvas centre whatever controls each mode
 * puts beside it; when those controls outgrow their half, their column widens
 * instead of overlapping the switch.
 */
export const modeHeaderClass =
  'from-surface-canvas via-surface-canvas/70 text-text-primary md:from-surface-canvas/80 md:via-surface-canvas/50 2xl:from-surface-canvas/0 absolute top-0 z-20 grid h-14 w-full grid-cols-[1fr_auto_1fr] items-center gap-2 bg-gradient-to-b to-transparent px-3 py-2 font-semibold md:h-[3.25rem] md:px-2 2xl:via-transparent';

/** A header column keeps its grid cell even when its controls are hidden. */
export const modeHeaderStartClass = 'flex min-w-0 items-center justify-start';
export const modeHeaderEndClass = 'flex min-w-0 items-center justify-end gap-2';

/** The welcome column: composer at the viewport floor on phones, centred from `sm` up. */
export const landingColumnClass = 'flex-1 items-center justify-end sm:justify-center';

export const landingGreetingBlockClass = 'flex flex-col items-center justify-center px-4';

export const landingGreetingClass =
  'text-text-primary max-w-2xl text-center text-[2.25rem] leading-[1.15] font-semibold tracking-[-0.02em]';

/** Room the greeting leaves above the composer, matching the composer's own clearance. */
export function landingGreetingSpacing(centerFormOnLanding: boolean): string {
  return centerFormOnLanding ? 'pb-8' : 'pb-8';
}

/** The band holding starters (Chat) or recent tasks (Work) and the composer. */
export const landingBandClass = 'max-w-[48rem]';

export const composerWidthClass = 'md:max-w-[48rem]';

/** A floating card in every state: the composer keeps a gutter on a phone. */
export const composerShapeClass = 'rounded-t-theme-surface-lg rounded-b-theme-surface-lg';

/** From `sm` up the landing composer leaves room for the footer beneath it. */
export function landingComposerClearance(centerFormOnLanding: boolean): string {
  /* The suggestion row now sits under the composer, so the landing band only
     needs the small gap before the footer rather than the footer's full height. */
  return centerFormOnLanding ? 'transition-all duration-200 sm:mb-4' : 'sm:mb-10';
}
