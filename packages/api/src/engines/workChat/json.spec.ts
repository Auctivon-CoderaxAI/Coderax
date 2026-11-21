import { isRecord, readString } from './json';

describe('work chat JSON guards', () => {
  it('treats plain objects as records and every other shape as not', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ agent_id: null })).toBe(true);
    expect(isRecord(Object.create(null))).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord('{}')).toBe(false);
    expect(isRecord(0)).toBe(false);
  });

  it('accepts only non-blank strings and preserves their exact value', () => {
    expect(readString('owner')).toBe('owner');
    expect(readString('  padded  ')).toBe('  padded  ');
    expect(readString('')).toBeUndefined();
    expect(readString('   ')).toBeUndefined();
    expect(readString('\n\t')).toBeUndefined();
    expect(readString(42)).toBeUndefined();
    expect(readString(null)).toBeUndefined();
    expect(readString(undefined)).toBeUndefined();
  });
});
