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

async function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), 2000);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
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

  test('cancels one non-streaming request without affecting another request', async () => {
    let resolveBothRequests!: () => void;
    const bothRequests = new Promise<void>((resolve) => {
      resolveBothRequests = resolve;
    });
    let resolveCancelledResponseClosed!: () => void;
    const cancelledResponseClosed = new Promise<void>((resolve) => {
      resolveCancelledResponseClosed = resolve;
    });
    const receivedPrompts = new Set<string>();
    const server = createServer((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => {
        body += chunk;
      });
      request.on('end', () => {
        const prompt = (
          JSON.parse(body) as { messages: Array<{ content: string }> }
        ).messages[0].content;
        receivedPrompts.add(prompt);
        if (receivedPrompts.size === 2) {
          resolveBothRequests();
        }

        if (prompt === 'cancel this request') {
          response.once('close', resolveCancelledResponseClosed);
          return;
        }

        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(responseChunk('survived', true));
      });
    });
    const baseURL = await listen(server);

    try {
      const client = new OllamaClient({ baseURL, streamRate: 0 });
      const controller = new AbortController();
      const cancelled = client.chatCompletion({
        payload: {
          model: 'qwen3.5:4b',
          stream: false,
          messages: [{ role: 'user', content: 'cancel this request' }],
        },
        abortController: controller,
      });
      const survivor = client.chatCompletion({
        payload: {
          model: 'qwen3.5:4b',
          stream: false,
          messages: [{ role: 'user', content: 'let this request finish' }],
        },
      });

      await withTimeout(bothRequests, 'Ollama SDK did not start both requests');
      controller.abort();

      await expect(withTimeout(cancelled, 'Cancelled Ollama request did not settle')).resolves.toBe(
        '',
      );
      await expect(
        withTimeout(survivor, 'Uncancelled Ollama request did not finish'),
      ).resolves.toBe('survived');
      await withTimeout(
        cancelledResponseClosed,
        'Ollama server did not observe the cancelled request closing',
      );
    } finally {
      await close(server);
    }
  });

  test('returns streamed content when cancellation interrupts the next chunk read', async () => {
    let resolveFirstToken!: () => void;
    const firstToken = new Promise<void>((resolve) => {
      resolveFirstToken = resolve;
    });
    let resolveResponseClosed!: () => void;
    const responseClosed = new Promise<void>((resolve) => {
      resolveResponseClosed = resolve;
    });
    const server = createServer((request, response) => {
      request.resume();
      response.once('close', resolveResponseClosed);
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
        onProgress: () => resolveFirstToken(),
        abortController: controller,
      });

      await withTimeout(firstToken, 'Ollama SDK did not emit the first streamed token');
      await new Promise((resolve) => setTimeout(resolve, 50));
      controller.abort();

      await expect(
        withTimeout(completion, 'Cancelled Ollama stream did not settle'),
      ).resolves.toBe('first');
      await withTimeout(responseClosed, 'Ollama server did not observe the stream closing');
    } finally {
      await close(server);
    }
  });
});
