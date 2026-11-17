import { scrubSecrets } from './redact';

describe('secret scrubbing', () => {
  it('redacts quoted JSON secret fields', () => {
    const result = scrubSecrets('{"password":"hunter2","api_key":"abc123","safe":"keep"}');

    expect(result.text).not.toContain('hunter2');
    expect(result.text).not.toContain('abc123');
    expect(result.text).toContain('"password":"[REDACTED]"');
    expect(result.text).toContain('"api_key":"[REDACTED]"');
    expect(result.text).toContain('"safe":"keep"');
    expect(result.redactions).toBe(2);
  });

  it('keeps unquoted assignments covered', () => {
    const result = scrubSecrets('password = hunter2');
    expect(result.text).toBe('password = [REDACTED]');
  });
});
