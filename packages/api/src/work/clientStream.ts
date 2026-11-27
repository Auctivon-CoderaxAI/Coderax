import type { NextFunction, Request, Response } from 'express';

interface EventIdState {
  next: number;
}

const FRAME_SEPARATOR = '\n\n';

type Write = (
  chunk: string | Uint8Array,
  encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
  callback?: (error?: Error | null) => void,
) => boolean;

/**
 * Prefixes each complete frame in `chunk` with the next id. A trailing partial
 * frame is kept byte-for-byte so a handler that splits a frame across writes is
 * never corrupted. A frame that already carries an id keeps it, which is how a
 * handler with its own durable cursor (the workflow run stream) is left alone.
 */
export function applyEventIds(chunk: string, state: EventIdState): string {
  if (!chunk.includes(FRAME_SEPARATOR)) {
    return chunk;
  }
  const parts = chunk.split(FRAME_SEPARATOR);
  const trailing = parts.pop();
  const framed = parts.map((frame) => {
    if (frame.length === 0 || /(^|\n)id:/.test(frame)) {
      return frame;
    }
    const id = `id: ${state.next}`;
    state.next += 1;
    const newline = frame.indexOf('\n');
    return newline === -1
      ? `${frame}\n${id}`
      : `${frame.slice(0, newline)}\n${id}${frame.slice(newline)}`;
  });
  return [...framed, trailing].join(FRAME_SEPARATOR);
}

/**
 * Adds a monotonic `id:` field to every SSE frame a response writes.
 *
 * A client that drops a connection keeps the last id it saw as a cursor, and
 * every later frame is provably newer than it. Writes that are not a complete
 * frame, or are not an event stream, pass through unchanged: the Work chat
 * route also serves JSON on the same response object.
 */
export function sseEventIds() {
  return function sseEventIdsMiddleware(_req: Request, res: Response, next: NextFunction): void {
    const write = res.write.bind(res) as unknown as Write;
    const state: EventIdState = { next: 1 };

    res.write = function writeWithEventIds(
      chunk: string | Uint8Array,
      encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
      callback?: (error?: Error | null) => void,
    ): boolean {
      const contentType = String(res.getHeader('Content-Type') ?? '');
      if (contentType.includes('text/event-stream') && typeof chunk === 'string') {
        return write(applyEventIds(chunk, state), encodingOrCallback, callback);
      }
      return write(chunk, encodingOrCallback, callback);
    } as unknown as typeof res.write;

    next();
  };
}
