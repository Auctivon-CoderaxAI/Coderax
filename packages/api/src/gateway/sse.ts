/**
 * A bounded reader for the engine's server-sent-event framing.
 *
 * The engine writes `data: <json>\n\n` frames. This reader enforces a maximum
 * frame size, an idle timeout and caller cancellation, and it surfaces a protocol
 * error instead of silently ending when the stream breaks mid-frame. It never
 * interprets a payload: validation belongs to the contract schemas.
 */

export type SseFrame = {
  event?: string;
  id?: string;
  data: string;
};

export class SseProtocolError extends Error {
  readonly code = 'protocol_error';

  constructor(message: string) {
    super(message);
    this.name = 'SseProtocolError';
  }
}

/** Recoverable interruption of the upstream event stream. */
export class SseReadError extends Error {}

/** EOF before the delimiter: replay can recover the missing complete frame. */
export class SseFramingError extends SseReadError {}

export type SseReadOptions = {
  idleTimeoutMs: number;
  maxFrameBytes?: number;
  signal?: AbortSignal;
};

const DEFAULT_MAX_FRAME_BYTES = 1_048_576;

type ByteStream = {
  getReader: () => {
    read: () => Promise<{ done: boolean; value?: Uint8Array }>;
    cancel: (reason?: unknown) => Promise<void>;
  };
};

function frameBytes(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function parseBlock(block: string): SseFrame | null {
  let event: string | undefined;
  let id: string | undefined;
  const data: string[] = [];
  for (const rawLine of block.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line.length === 0 || line.startsWith(':')) {
      continue;
    }
    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1 ? '' : line.slice(separator + 1).replace(/^ /, '');
    if (field === 'data') {
      data.push(value);
    } else if (field === 'event') {
      event = value;
    } else if (field === 'id') {
      id = value;
    }
  }
  if (data.length === 0) {
    return null;
  }
  return {
    data: data.join('\n'),
    ...(event == null ? {} : { event }),
    ...(id == null ? {} : { id }),
  };
}

export async function* readSseFrames(
  body: unknown,
  options: SseReadOptions,
): AsyncIterable<SseFrame> {
  const stream = body as ByteStream | null;
  if (stream == null || typeof stream.getReader !== 'function') {
    throw new SseProtocolError('The engine response did not carry an event stream.');
  }
  const reader = stream.getReader();
  const maxFrameBytes = options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;

  /**
   * The idle deadline and caller cancellation must win the race before the
   * reader is cancelled: cancelling a WHATWG stream resolves a pending read with
   * `done: true`, which would otherwise look like a clean end of stream.
   */
  const readWithTimeout = async (): Promise<{ done: boolean; value?: Uint8Array }> => {
    if (options.signal?.aborted) {
      throw new SseProtocolError('The engine event stream was cancelled.');
    }
    let timer: NodeJS.Timeout | undefined;
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      if (options.signal == null) {
        return;
      }
      onAbort = () => reject(new SseProtocolError('The engine event stream was cancelled.'));
      options.signal.addEventListener('abort', onAbort, { once: true });
    });
    const timedOut = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new SseProtocolError('The engine event stream went idle.')),
        options.idleTimeoutMs,
      );
    });
    try {
      return await Promise.race([
        reader.read().catch(() => {
          throw new SseReadError('The engine event stream could not be read.');
        }),
        timedOut,
        aborted,
      ]);
    } finally {
      if (timer != null) {
        clearTimeout(timer);
      }
      if (onAbort != null) {
        options.signal?.removeEventListener('abort', onAbort);
      }
    }
  };

  try {
    while (!finished) {
      const chunk = await readWithTimeout();
      if (chunk.done) {
        finished = true;
      } else if (chunk.value != null) {
        buffer += decoder.decode(chunk.value, { stream: true });
      }

      // Emit every complete frame before measuring what remains, so several
      // valid frames arriving in one chunk are not mistaken for one oversize one.
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (frameBytes(block) > maxFrameBytes) {
          throw new SseProtocolError('The engine event frame exceeded the size limit.');
        }
        const frame = parseBlock(block);
        if (frame != null) {
          yield frame;
        }
        boundary = buffer.indexOf('\n\n');
      }

      // A trailing newline may be the first half of a delimiter split across chunks.
      const partial = !finished && buffer.endsWith('\n') ? buffer.slice(0, -1) : buffer;
      if (frameBytes(partial) > maxFrameBytes) {
        throw new SseProtocolError('The engine event frame exceeded the size limit.');
      }
    }

    buffer += decoder.decode();
    // A close before the delimiter leaves an incomplete frame; the client can
    // replay it from the last delivered sequence instead of accepting it.
    if (buffer.trim().length > 0) {
      throw new SseFramingError('The engine event stream ended before the frame delimiter.');
    }
  } finally {
    if (!finished) {
      await reader.cancel().catch(() => undefined);
    }
  }
}
