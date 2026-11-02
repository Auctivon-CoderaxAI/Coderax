import { CYVOX_MAX_RESPONSE_BYTES, readBoundedBody } from './response';

describe('CyVox bounded body reader', () => {
  it('returns a body at the exact limit', async () => {
    const payload = 'a'.repeat(CYVOX_MAX_RESPONSE_BYTES);
    await expect(readBoundedBody(new Response(payload))).resolves.toEqual({
      ok: true,
      body: payload,
    });
  });

  it('rejects one byte over the limit', async () => {
    const payload = 'a'.repeat(CYVOX_MAX_RESPONSE_BYTES + 1);
    await expect(readBoundedBody(new Response(payload))).resolves.toEqual({
      ok: false,
      code: 'too_large',
    });
  });

  it('rejects an oversized declared length before reading the stream', async () => {
    let reads = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        reads += 1;
        controller.enqueue(new Uint8Array(1024));
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = new Response(stream, {
      headers: { 'Content-Length': String(CYVOX_MAX_RESPONSE_BYTES + 1) },
    });

    await expect(readBoundedBody(response)).resolves.toEqual({ ok: false, code: 'too_large' });
    expect(reads).toBe(0);
    expect(cancelled).toBe(true);
  });

  it('cancels an undeclared stream once it passes the limit', async () => {
    let sent = 0;
    let cancelled = false;
    const chunk = new Uint8Array(64 * 1024).fill(32);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });

    await expect(readBoundedBody(new Response(stream))).resolves.toEqual({
      ok: false,
      code: 'too_large',
    });
    expect(cancelled).toBe(true);
    // The stream's own read-ahead buffers a couple of chunks; the point is that an
    // endless body is abandoned near the limit instead of being consumed.
    expect(sent).toBeLessThan(CYVOX_MAX_RESPONSE_BYTES * 2);
  });

  it('decodes a multi-byte body under the byte limit', async () => {
    const value = { title: '智能体' };
    await expect(
      readBoundedBody(
        new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }),
      ),
    ).resolves.toEqual({ ok: true, body: JSON.stringify(value) });
  });

  it('returns an empty body when the response has none', async () => {
    await expect(readBoundedBody(new Response(null, { status: 204 }))).resolves.toEqual({
      ok: true,
      body: '',
    });
  });
});
