import { EXPANDED_MIN } from './constants';

export const WIDTH_STORAGE_KEY = 'side:width';

/**
 * Restores the stored sidebar width, clamped to the range the resize handlers
 * allow at the current rem scale. A width saved at a smaller scale (or a wider
 * viewport) would otherwise exceed the 40% cap until the user dragged it back.
 */
export function getInitialWidth(remScale = 1): number {
  const saved = Number(localStorage.getItem(WIDTH_STORAGE_KEY));
  const maxWidth = (window.innerWidth * 0.4) / remScale;
  /** The scaled minimum can exceed the viewport cap, so it yields to the cap. */
  const minWidth = Math.min(EXPANDED_MIN, maxWidth);
  const width = Number.isFinite(saved) && saved > 0 ? saved : EXPANDED_MIN;
  return Math.min(Math.max(width, minWidth), maxWidth);
}