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

  const readWithTimeout = async (): Promise<{ done: boolean; value?: Uint8Array }> => {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        void reader.cancel().catch(() => undefined);
        reject(new SseProtocolError('The engine event stream went idle.'));
      }, options.idleTimeoutMs);
    });
    try {
      return await Promise.race([reader.read(), timeout]);
    } finally {
      if (timer != null) {
        clearTimeout(timer);
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
        if (buffer.length > maxFrameBytes * 2) {
          throw new SseProtocolError('The engine event frame exceeded the size limit.');
        }
      }

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (block.length > maxFrameBytes) {
          throw new SseProtocolError('The engine event frame exceeded the size limit.');
        }
        const frame = parseBlock(block);
        if (frame != null) {
          yield frame;
        }
        boundary = buffer.indexOf('\n\n');
      }
    }

    buffer += decoder.decode();
    if (buffer.trim().length > 0) {
      const frame = parseBlock(buffer);
      if (frame != null) {
        yield frame;
      }
    }
  } finally {
    if (!finished) {
      await reader.cancel().catch(() => undefined);
    }
  }
}
