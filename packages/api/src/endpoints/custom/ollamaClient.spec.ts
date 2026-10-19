import axios from 'axios';
import { Ollama } from 'ollama';
import type { OllamaChatPayload } from './ollamaClient';
import { OllamaClient } from './ollamaClient';

jest.mock('axios', () => ({ get: jest.fn() }));
jest.mock('ollama', () => ({ Ollama: jest.fn() }));
jest.mock('@librechat/agents', () => ({ sleep: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@coderax/data-schemas', () => ({ logger: { error: jest.fn() } }));
jest.mock('coderax-data-provider', () => ({ Constants: { DEFAULT_STREAM_RATE: 0 } }));
jest.mock('~/utils', () => ({
  resolveHeaders: jest.fn(() => ({})),
  deriveBaseURL: jest.fn((url: string) => url),
}));

const mockedAxios = jest.mocked(axios);
const mockedOllama = jest.mocked(Ollama);

describe('OllamaClient.chatCompletion', () => {
  let chat: jest.Mock;
  let client: OllamaClient;

  beforeEach(() => {
    jest.clearAllMocks();
    chat = jest.fn();
    mockedOllama.mockImplementation(() => ({ chat }) as unknown as Ollama);
    client = new OllamaClient();
  });

  const payload = (stream?: boolean): OllamaChatPayload => ({
    model: 'qwen3.5:4b',
    ...(stream === undefined ? {} : { stream }),
    messages: [{ role: 'user', content: 'Hello' }],
  });

  test('returns and emits a non-streaming Ollama reply', async () => {
    chat.mockResolvedValue({ message: { content: 'LOCAL_OK' } });
    const onProgress = jest.fn();

    await expect(client.chatCompletion({ payload: payload(false), onProgress })).resolves.toBe(
      'LOCAL_OK',
    );
    expect(onProgress).toHaveBeenCalledWith('LOCAL_OK');
    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({ stream: false, messages: [{ role: 'user', content: 'Hello' }] }),
    );
  });

  test('defaults to a non-streaming request when stream is omitted', async () => {
    chat.mockResolvedValue({ message: { content: 'LOCAL_OK' } });

    await expect(
      client.chatCompletion({ payload: payload(), onProgress: jest.fn() }),
    ).resolves.toBe('LOCAL_OK');
    expect(chat).toHaveBeenCalledWith(expect.objectContaining({ stream: false }));
  });

  test('streams tokens without requiring an AbortController', async () => {
    chat.mockResolvedValue({
      abort: jest.fn(),
      async *[Symbol.asyncIterator]() {
        yield { message: { content: 'LOCAL' } };
        yield { message: { content: '_OK' } };
      },
    });
    const onProgress = jest.fn();

    await expect(client.chatCompletion({ payload: payload(true), onProgress })).resolves.toBe(
      'LOCAL_OK',
    );
    expect(onProgress.mock.calls).toEqual([['LOCAL'], ['_OK']]);
  });

  test('does not send an inference request after cancellation', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      client.chatCompletion({ payload: payload(true), abortController: controller }),
    ).resolves.toBe('');
    expect(chat).not.toHaveBeenCalled();
  });

  test('stops an in-flight stream after cancellation', async () => {
    const controller = new AbortController();
    const abort = jest.fn();
    chat.mockResolvedValue({
      abort,
      async *[Symbol.asyncIterator]() {
        yield { message: { content: 'first' } };
        yield { message: { content: 'second' } };
      },
    });
    const onProgress = jest.fn(() => controller.abort());

    await expect(
      client.chatCompletion({ payload: payload(true), onProgress, abortController: controller }),
    ).resolves.toBe('first');
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(abort).toHaveBeenCalledTimes(1);
  });

  test('aborts streams created by an older SDK through their controller', async () => {
    const controller = new AbortController();
    const abort = jest.fn();
    chat.mockResolvedValue({
      controller: { abort },
      async *[Symbol.asyncIterator]() {
        yield { message: { content: 'first' } };
        yield { message: { content: 'second' } };
      },
    });
    const onProgress = jest.fn(() => controller.abort());

    await expect(
      client.chatCompletion({ payload: payload(true), onProgress, abortController: controller }),
    ).resolves.toBe('first');
    expect(abort).toHaveBeenCalledTimes(1);
  });

  test('does not emit an empty non-streaming response', async () => {
    chat.mockResolvedValue({ message: { content: '' } });
    const onProgress = jest.fn();

    await expect(client.chatCompletion({ payload: payload(false), onProgress })).resolves.toBe('');
    expect(onProgress).not.toHaveBeenCalled();
  });

  test('rejects redirected model-inventory requests', async () => {
    mockedAxios.get.mockResolvedValue({ data: { models: [{ name: 'qwen3.5:4b' }] } });

    await expect(OllamaClient.fetchModels('http://localhost:11434')).resolves.toEqual([
      'qwen3.5:4b',
    ]);
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'http://localhost:11434/api/tags',
      expect.objectContaining({ maxRedirects: 0, timeout: 5000 }),
    );
  });
});
