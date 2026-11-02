import { capResponseBytes } from './http';

describe('capResponseBytes', () => {
  it('passes a body at the limit through with status, status text and headers', async () => {
    const response = new Response('abcd', {
      status: 201,
      statusText: 'Created',
      headers: { 'content-type': 'text/plain', 'x-test': 'yes' },
    });

    const capped = capResponseBytes(response, 4);

    expect(capped.status).toBe(201);
    expect(capped.statusText).toBe('Created');
    expect(capped.headers.get('x-test')).toBe('yes');
    await expect(capped.text()).resolves.toBe('abcd');
  });

  it('fails the body once it passes the limit and cancels the source', async () => {
    let sent = 0;
    let cancelled = false;
    const chunk = new Uint8Array(64 * 1024).fill(32);
    const source = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });

    const capped = capResponseBytes(new Response(source), 1024);

    await expect(capped.text()).rejects.toThrow('exceeded the size limit');
    /** Cancellation reaches the source on a following task, after the read rejects. */
    await new Promise((resolve) => setImmediate(resolve));
    expect(cancelled).toBe(true);
    expect(sent).toBeLessThan(512 * 1024);
  });

  it('returns a response without a body unchanged', () => {
    const response = new Response(null, { status: 204 });
    expect(capResponseBytes(response, 1)).toBe(response);
  });
});
