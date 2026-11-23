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

  it('redacts explicitly identified short secrets without relying on a minimum length', () => {
    const result = scrubSecrets('token=abc; pin=xy', {
      env: { SERVICE_TOKEN: 'abc' },
      knownSecrets: ['xy'],
    });
    expect(result.text).not.toContain('abc');
    expect(result.text).not.toContain('xy');
    expect(result.redactions).toBeGreaterThanOrEqual(2);
  });

  it('keeps unquoted assignments covered', () => {
    const result = scrubSecrets('password = hunter2');
    expect(result.text).toBe('password = [REDACTED]');
  });

  it('consumes escaped quotes in a secret value', () => {
    const result = scrubSecrets(`{"password":"abc${String.fromCharCode(92)}"suffix"}`);
    expect(result.text).toBe('{"password":"[REDACTED]"}');
    expect(result.text).not.toContain('suffix');
  });
});
