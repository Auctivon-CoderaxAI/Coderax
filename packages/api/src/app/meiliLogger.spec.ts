import { shouldUseMeiliFileLogging } from './meiliLogger';

describe('shouldUseMeiliFileLogging', () => {
  it('disables file writes on Vercel even when LOG_TO_FILE is enabled', () => {
    expect(shouldUseMeiliFileLogging({ vercel: '1', logToFile: true })).toBe(false);
  });

  it('keeps file logging enabled by default outside Vercel', () => {
    expect(shouldUseMeiliFileLogging({})).toBe(true);
  });

  it('honors LOG_TO_FILE=false outside Vercel', () => {
    expect(shouldUseMeiliFileLogging({ logToFile: 'false' })).toBe(false);
  });
});
