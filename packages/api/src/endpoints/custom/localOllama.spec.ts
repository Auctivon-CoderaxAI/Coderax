import { isKeylessLocalOllama } from './localOllama';

describe('isKeylessLocalOllama', () => {
  it('accepts only an Ollama endpoint on plain HTTP loopback without a key', () => {
    expect(isKeylessLocalOllama({ name: 'Ollama', baseURL: 'http://127.0.0.1:11434/v1' })).toBe(
      true,
    );
    expect(
      isKeylessLocalOllama({ name: 'Ollama-local', baseURL: 'http://localhost:11434/v1' }),
    ).toBe(true);
    expect(isKeylessLocalOllama({ name: 'Ollama', baseURL: 'http://[::1]:11434/v1' })).toBe(true);
    expect(isKeylessLocalOllama({ name: 'Ollama', baseURL: 'https://example.com/v1' })).toBe(false);
    expect(isKeylessLocalOllama({ name: 'Remote', baseURL: 'http://127.0.0.1:11434/v1' })).toBe(
      false,
    );
    expect(
      isKeylessLocalOllama({
        name: 'Ollama',
        baseURL: 'http://127.0.0.1:11434/v1',
        apiKey: 'configured-key',
      }),
    ).toBe(false);
  });
});
