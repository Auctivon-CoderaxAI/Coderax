import { readOAuthErrorText, readOAuthJson } from './response';

const MAX_TOKEN_BYTES = 1024 * 1024;

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
}

describe('MCP OAuth upstream body bounds', () => {
  it('parses a token document', async () => {
    const tokens = { access_token: 'access', refresh_token: 'refresh', expires_in: 3600 };
    await expect(readOAuthJson(json(tokens))).resolves.toEqual(tokens);
  });

  it('rejects a declared oversized token response before reading it', async () => {
    let reads = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        reads += 1;
        controller.enqueue(new Uint8Array(1024));
      },
    });
    const response = new Response(stream, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(MAX_TOKEN_BYTES + 1),
      },
    });

    await expect(readOAuthJson(response)).rejects.toThrow('exceeded the size limit');
    expect(reads).toBeLessThanOrEqual(1);
  });

  it('stops reading a token response that passes the limit', async () => {
    let sent = 0;
    const chunk = new Uint8Array(64 * 1024).fill(32);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });

    await expect(readOAuthJson(new Response(stream))).rejects.toThrow('exceeded the size limit');
    expect(sent).toBeLessThan(MAX_TOKEN_BYTES * 2);
  });

  it('rejects a token response that is not a JSON object', async () => {
    await expect(readOAuthJson(json([]))).rejects.toThrow('not a JSON object');
    await expect(readOAuthJson(json('access'))).rejects.toThrow('not a JSON object');
    await expect(readOAuthJson(new Response('not json'))).rejects.toThrow();
  });

  it('uses the accessor for a response without a stream', async () => {
    await expect(
      readOAuthJson({ json: async () => ({ access_token: 'access' }) } as unknown as Response),
    ).resolves.toEqual({ access_token: 'access' });
    await expect(
      readOAuthErrorText({ text: async () => 'invalid_grant' } as unknown as Response),
    ).resolves.toBe('invalid_grant');
  });

  it('quotes only a bounded prefix of an error body', async () => {
    await expect(readOAuthErrorText(new Response('e'.repeat(400)))).resolves.toHaveLength(300);
  });

  it('does not read an oversized error body', async () => {
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = new Uint8Array(64 * 1024);
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const response = new Response(stream, {
      headers: { 'Content-Length': String(64 * 1024 * 1024) },
    });

    await expect(readOAuthErrorText(response)).resolves.toBe('response body too large');
    expect(sent).toBe(0);
  });

  it('returns an empty string for an empty error body', async () => {
    await expect(readOAuthErrorText(new Response(''))).resolves.toBe('');
  });

  it('keeps the error code ahead of a description that fills the truncation window', async () => {
    const body = JSON.stringify({
      error_description: 'd'.repeat(600),
      error: 'invalid_scope',
    });

    const text = await readOAuthErrorText(new Response(body));

    expect(text.startsWith('invalid_scope:')).toBe(true);
    expect(text.length).toBe(300);
  });
});
