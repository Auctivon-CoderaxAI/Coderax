// client/src/components/UnifiedSidebar/__tests__/width.spec.ts
import { EXPANDED_MIN } from '../constants';
import { getInitialWidth, WIDTH_STORAGE_KEY } from '../width';

/**
 * The stored width is clamped to [min(EXPANDED_MIN, max), max], where
 * max = innerWidth * 0.4 / remScale — the same range the resize handlers use.
 */
describe('getInitialWidth', () => {
  const setViewport = (width: number) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  };

  beforeEach(() => {
    localStorage.clear();
    setViewport(2000); // max = 800 at scale 1
  });

  it('defaults to EXPANDED_MIN when nothing is stored', () => {
    expect(getInitialWidth(1)).toBe(EXPANDED_MIN);
  });

  it('restores a stored width inside the range', () => {
    localStorage.setItem(WIDTH_STORAGE_KEY, '500');
    expect(getInitialWidth(1)).toBe(500);
  });

  it('raises a stored width below the minimum', () => {
    localStorage.setItem(WIDTH_STORAGE_KEY, '100');
    expect(getInitialWidth(1)).toBe(EXPANDED_MIN);
  });

  it('clamps a stored width to the scaled maximum', () => {
    localStorage.setItem(WIDTH_STORAGE_KEY, '700');
    expect(getInitialWidth(2)).toBe(400);
  });

  it('lets the minimum yield to the cap on narrow viewports', () => {
    setViewport(500); // max = 200
    localStorage.setItem(WIDTH_STORAGE_KEY, '500');
    expect(getInitialWidth(1)).toBe(200);
  });

  it('ignores a non-numeric stored value', () => {
    localStorage.setItem(WIDTH_STORAGE_KEY, 'abc');
    expect(getInitialWidth(1)).toBe(EXPANDED_MIN);
  });
});