import { buildEnginePrompt } from './prompt';

const message = (text: string, isCreatedByUser = true) => ({ text, isCreatedByUser });

describe('buildEnginePrompt', () => {
  it('returns the request unchanged when there is no history', () => {
    expect(buildEnginePrompt([], '  Fix\nit  ')).toBe('  Fix\nit  ');
  });

  it('returns the request unchanged when every history message is blank', () => {
    expect(buildEnginePrompt([message('   '), message('\n\t', false)], 'Fix it')).toBe('Fix it');
  });

  it('labels history and keeps it oldest to newest', () => {
    expect(
      buildEnginePrompt([message('first'), message('second', false), message('third')], 'Fix it'),
    ).toBe(
      'Earlier in this Work conversation:\nUser: first\nAssistant: second\nUser: third\n\nCurrent request:\nFix it',
    );
  });

  it('trims message text and skips blank entries', () => {
    expect(
      buildEnginePrompt(
        [message('  first  '), message('   ', false), message('\nsecond\n', false)],
        'Fix it',
      ),
    ).toBe(
      'Earlier in this Work conversation:\nUser: first\nAssistant: second\n\nCurrent request:\nFix it',
    );
  });

  it('keeps only the last 12 messages', () => {
    const history = Array.from({ length: 14 }, (_, index) => message(`message-${index + 1}`));
    const lines = buildEnginePrompt(history, 'Fix it').split('\n');

    expect(lines).toContain('User: message-3');
    expect(lines).toContain('User: message-14');
    expect(lines).not.toContain('User: message-1');
    expect(lines).not.toContain('User: message-2');
  });

  it('caps a single message at 4000 characters', () => {
    const prompt = buildEnginePrompt([message('x'.repeat(4500))], 'Fix it');

    expect(prompt.split('\n')[1]).toBe(`User: ${'x'.repeat(4000)}`);
  });

  it('drops older history once the 24000 character budget is reached', () => {
    const history = Array.from({ length: 12 }, (_, index) =>
      message(`${index}:${'x'.repeat(3990)}`, false),
    );
    const lines = buildEnginePrompt(history, 'Fix it').split('\n').slice(1, -3);

    expect(lines).toHaveLength(5);
    expect(lines[0]).toContain('Assistant: 7:');
    expect(lines[lines.length - 1]).toContain('Assistant: 11:');
    expect(lines.reduce((total, line) => total + line.length, 0)).toBeLessThanOrEqual(24_000);
  });
});
