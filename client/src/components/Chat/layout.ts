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
  'from-surface-canvas via-surface-canvas/70 text-text-primary md:from-surface-canvas/80 md:via-surface-canvas/50 2xl:from-surface-canvas/0 absolute top-0 z-20 grid h-[3.25rem] w-full grid-cols-[1fr_auto_1fr] items-center gap-2 bg-gradient-to-b to-transparent p-2 font-semibold 2xl:via-transparent';

/** A header column keeps its grid cell even when its controls are hidden. */
export const modeHeaderStartClass = 'flex min-w-0 items-center justify-start';
export const modeHeaderEndClass = 'flex min-w-0 items-center justify-end gap-2';

/** The welcome column: composer at the viewport floor on phones, centred from `sm` up. */
export const landingColumnClass = 'flex-1 items-center justify-end sm:justify-center';

export const landingGreetingBlockClass = 'flex h-full flex-col items-center justify-center px-4';

export const landingGreetingClass =
  'text-text-primary max-w-2xl text-center text-3xl leading-tight font-normal tracking-tight';

/** Room the greeting leaves above the composer, matching the composer's own clearance. */
export function landingGreetingSpacing(centerFormOnLanding: boolean): string {
  return centerFormOnLanding ? 'pb-16' : 'pb-10';
}

/** The band holding starters (Chat) or recent tasks (Work) and the composer. */
export const landingBandClass = 'max-w-3xl xl:max-w-4xl';

export const composerWidthClass = 'md:max-w-3xl xl:max-w-4xl';

/** Squared off at the viewport floor below `sm`, where nothing follows it. */
export const composerShapeClass = 'rounded-t-theme-surface-lg sm:rounded-theme-surface-lg';

/** From `sm` up the landing composer leaves room for the footer beneath it. */
export function landingComposerClearance(centerFormOnLanding: boolean): string {
  return centerFormOnLanding ? 'transition-all duration-200 sm:mb-28' : 'sm:mb-10';
}
