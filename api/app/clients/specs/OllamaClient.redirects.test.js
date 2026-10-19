const http = require('node:http');
const { OllamaClient } = require('../OllamaClient');

jest.mock('ollama', () => ({ Ollama: jest.fn() }));
jest.mock('@librechat/agents', () => ({ sleep: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@coderax/data-schemas', () => ({ logger: { error: jest.fn() } }));
jest.mock('coderax-data-provider', () => ({ Constants: { DEFAULT_STREAM_RATE: 0 } }));
jest.mock('@coderax/api', () => ({
  resolveHeaders: jest.fn(() => ({ 'x-local-probe': 'sensitive-test-value' })),
  deriveBaseURL: jest.fn((url) => url),
}));

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function close(server) {
  if (!server.listening) {
    return;
  }
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

describe('OllamaClient.fetchModels redirect safety', () => {
  test('does not forward resolved headers to a redirected server', async () => {
    let redirectedRequests = 0;
    const target = http.createServer((_request, response) => {
      redirectedRequests += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ models: [{ name: 'qwen3.5:4b' }] }));
    });
    const targetURL = await listen(target);
    const source = http.createServer((_request, response) => {
      response.writeHead(302, { location: `${targetURL}/api/tags` });
      response.end();
    });
    const sourceURL = await listen(source);

    try {
      await expect(
        OllamaClient.fetchModels(sourceURL, {
          headers: { 'x-local-probe': 'sensitive-test-value' },
        }),
      ).rejects.toThrow();
      expect(redirectedRequests).toBe(0);
    } finally {
      await close(source);
      await close(target);
    }
  });
});
