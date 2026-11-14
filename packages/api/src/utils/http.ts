/**
 * Normalizes an error-like object into an HTTP status and message.
 * Ensures we always respond with a valid numeric status to avoid UI hangs.
 */
export function normalizeHttpError(
  err: Error | { status?: number; message?: string } | unknown,
  fallbackStatus = 400,
): {
  status: number;
  message: string;
} {
  let status = fallbackStatus;
  if (err && typeof err === 'object' && 'status' in err && typeof err.status === 'number') {
    status = err.status;
  }

  let message = 'An error occurred.';
  if (
    err &&
    typeof err === 'object' &&
    'message' in err &&
    typeof err.message === 'string' &&
    err.message.length > 0
  ) {
    message = err.message;
  }

  return { status, message };
}

export type BoundedBytes = { ok: true; body: Uint8Array } | { ok: false; code: 'too_large' };

function joinChunks(chunks: Uint8Array[], size: number): Uint8Array {
  if (chunks.length === 1) return chunks[0];
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

/**
 * Reads at most `limit` bytes of a response body. A declared Content-Length over the
 * limit is rejected before any read; otherwise the stream is cancelled as soon as the
 * received byte count would exceed it, so peak memory stays bounded either way.
 * Forwarding callers should use this instead of `arrayBuffer()`, which buffers whatever
 * an upstream sends before any size check can run.
 */
export async function readBoundedBytes(response: Response, limit: number): Promise<BoundedBytes> {
  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: false, code: 'too_large' };
  }

  if (!response.body) return { ok: true, body: new Uint8Array(0) };

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > limit) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, code: 'too_large' };
    }
    chunks.push(value);
  }

  return { ok: true, body: joinChunks(chunks, received) };
}

/**
 * Returns a response whose body stream fails once it exceeds `limit` bytes, cancelling the
 * upstream read. SDKs that call `response.json()` themselves get the same bound as callers
 * using {@link readBoundedBytes}, instead of buffering whatever the server sends.
 */
export function capResponseBytes(response: Response, limit: number): Response {
  /** A real fetch body is a stream; non-streaming doubles keep their own shape. */
  if (!response.body || typeof response.body.pipeThrough !== 'function') return response;
  let received = 0;
  const capped = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > limit) {
          controller.error(new Error('Response body exceeded the size limit'));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
  return new Response(capped, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
