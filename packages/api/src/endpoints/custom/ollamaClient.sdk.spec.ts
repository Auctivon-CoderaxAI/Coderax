import { createServer } from 'node:http';
import { OllamaClient } from './ollamaClient';

function listen(server: ReturnType<typeof createServer>): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Unable to read the local test server address'));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function close(server: ReturnType<typeof createServer>): Promise<void> {
  if (!server.listening) {
    return;
  }
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function responseChunk(content: string, done: boolean): string {
  return `${JSON.stringify({
    model: 'qwen3.5:4b',
    created_at: new Date().toISOString(),
    message: { role: 'assistant', content },
    done,
  })}\n`;
}

describe('OllamaClient with the installed Ollama SDK', () => {
  test('returns non-streaming replies from a local Ollama-compatible server', async () => {
    let receivedStreamSetting: unknown;
    const server = createServer((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => {
        body += chunk;
      });
      request.on('end', () => {
        receivedStreamSetting = (JSON.parse(body) as { stream?: unknown }).stream;
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(responseChunk('LOCAL_OK', true));
      });
    });
    const baseURL = await listen(server);

    try {
      const client = new OllamaClient({ baseURL, streamRate: 0 });
      const onProgress = jest.fn();
      await expect(
        client.chatCompletion({
          payload: {
            model: 'qwen3.5:4b',
            stream: false,
            messages: [{ role: 'user', content: 'Reply with LOCAL_OK.' }],
          },
          onProgress,
        }),
      ).resolves.toBe('LOCAL_OK');
      expect(receivedStreamSetting).toBe(false);
      expect(onProgress).toHaveBeenCalledWith('LOCAL_OK');
    } finally {
      await close(server);
    }
  });

  test('cancels the installed SDK stream when the caller aborts', async () => {
    let resolveResponseClosed!: () => void;
    const responseClosed = new Promise<void>((resolve) => {
      resolveResponseClosed = resolve;
    });
    const server = createServer((_request, response) => {
      response.on('close', resolveResponseClosed);
      response.writeHead(200, { 'content-type': 'application/x-ndjson' });
      response.write(responseChunk('first', false));
    });
    const baseURL = await listen(server);

    try {
      const client = new OllamaClient({ baseURL, streamRate: 0 });
      const controller = new AbortController();
      const completion = client.chatCompletion({
        payload: {
          model: 'qwen3.5:4b',
          stream: true,
          messages: [{ role: 'user', content: 'Reply with two parts.' }],
        },
        onProgress: () => controller.abort(),
        abortController: controller,
      });

      await expect(completion).resolves.toBe('first');
      await expect(
        Promise.race([
          responseClosed,
          new Promise<never>((_resolve, reject) => {
            setTimeout(
              () => reject(new Error('Ollama SDK did not close the cancelled response')),
              2000,
            );
          }),
        ]),
      ).resolves.toBeUndefined();
    } finally {
      await close(server);
    }
  });
});
