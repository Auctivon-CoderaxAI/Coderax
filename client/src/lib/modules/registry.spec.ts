import { MODULES } from './registry';

describe('module registry', () => {
  it('keeps every id unique so the palette can track the active row', () => {
    const ids = MODULES.map((module) => module.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps every destination a distinct absolute route', () => {
    const paths = MODULES.map((module) => module.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) {
      expect(path.startsWith('/')).toBe(true);
      expect(path).not.toBe('/');
    }
  });
});
