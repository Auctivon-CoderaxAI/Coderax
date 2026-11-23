import { request } from 'coderax-data-provider';
import type { ChatEvent, ChatStreamConnection } from 'coderax-data-provider';
import { normalizeFrame } from '~/hooks/SSE/transport/frames';

type EngineStream = {
  id: string;
  frames: ChatEvent[];
  subscribers: Set<(event: ChatEvent) => void>;
  done: boolean;
};

type EngineStartOptions = {
  url: string;
  payload: Record<string, unknown>;
  signal?: AbortSignal;
};

type EngineStartResult = { streamId: string; conversationId: string };

const engineStreams = new Map<string, EngineStream>();
const ENGINE_STREAM_TTL_MS = 10 * 60 * 1000;

function parseFrame(block: string): ChatEvent | undefined {
  const data = block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (!data) {
    return undefined;
  }
  try {
    return normalizeFrame(JSON.parse(data));
  } catch {
    return undefined;
  }
}

function retireStream(stream: EngineStream): void {
  setTimeout(() => {
    if (engineStreams.get(stream.id) === stream) {
      engineStreams.delete(stream.id);
    }
  }, ENGINE_STREAM_TTL_MS).unref?.();
}

function publish(stream: EngineStream, event: ChatEvent): void {
  stream.frames.push(event);
  for (const subscriber of stream.subscribers) {
    try {
      subscriber(event);
    } catch {
      // A closed subscription must not stop the engine stream.
    }
  }
  if (event.type === 'final') {
    stream.done = true;
    stream.subscribers.clear();
    retireStream(stream);
  }
}

function statusError(status: number, data: unknown, headers: Headers): Error {
  const message =
    data != null &&
    typeof data === 'object' &&
    typeof (data as { message?: unknown }).message === 'string'
      ? (data as { message: string }).message
      : `Generation request failed with status ${status}`;
  const error = new Error(message) as Error & {
    response?: { status: number; data: unknown; headers: Record<string, string> };
  };
  const responseHeaders: Record<string, string> = {};
  headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });
  error.response = { status, data, headers: responseHeaders };
  return error;
}

/**
 * The engine streams SSE from the Work POST itself, while the chat runtime
 * expects a JSON `{ streamId }` and then subscribes to `/chat/stream/:id`.
 * Read the POST stream here, hand the runtime the created conversation id, and
 * bridge the frames into that subscription.
 */
export async function startEngineWorkChat({
  url,
  payload,
  signal,
}: EngineStartOptions): Promise<EngineStartResult> {
  const response = await request.authenticatedFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
    body: JSON.stringify(payload),
    signal,
  });

  const contentType = response.headers.get('content-type') ?? '';
  if (!response.ok || !response.body || !contentType.includes('text/event-stream')) {
    const text = await response.text();
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {
      // A plain-text error is already useful as the failure message.
    }
    throw statusError(response.status, data, response.headers);
  }

  const stream: EngineStream = {
    id: '',
    frames: [],
    subscribers: new Set(),
    done: false,
  };

  let resolveStarted!: (result: EngineStartResult) => void;
  let rejectStarted!: (error: unknown) => void;
  const started = new Promise<EngineStartResult>((resolve, reject) => {
    resolveStarted = resolve;
    rejectStarted = reject;
  });

  const register = (conversationId: string): void => {
    if (stream.id) {
      return;
    }
    stream.id = conversationId;
    engineStreams.set(conversationId, stream);
    resolveStarted({ streamId: conversationId, conversationId });
  };

  const consume = async (): Promise<void> => {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        if (signal?.aborted) {
          await reader.cancel();
          return;
        }
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const event = parseFrame(block);
          if (event) {
            if (event.type === 'created') {
              const conversationId = event.data?.message?.conversationId;
              if (typeof conversationId === 'string' && conversationId.length > 0) {
                register(conversationId);
              }
            } else if (event.type === 'final' && !stream.id) {
              const conversationId = event.data?.conversation?.conversationId;
              if (typeof conversationId === 'string' && conversationId.length > 0) {
                register(conversationId);
              }
            }
            publish(stream, event);
          }
          boundary = buffer.indexOf('\n\n');
        }
      }
      if (!stream.done) {
        publish(stream, {
          type: 'error',
          status: 0,
          data: { message: 'The engine stream ended before it finished.' },
        });
      }
    } finally {
      reader.releaseLock();
    }
  };

  void consume().catch((error) => {
    if (!stream.id) {
      rejectStarted(error);
      return;
    }
    publish(stream, {
      type: 'error',
      status: 0,
      data: { message: error instanceof Error ? error.message : 'The engine stream failed.' },
    });
  });

  return started;
}

/** Replays the engine POST frames, then forwards live frames, without a GET. */
export function attachEngineStream(
  streamId: string,
  options: { signal?: AbortSignal; onEvent: (event: ChatEvent) => void },
): ChatStreamConnection | null {
  const stream = engineStreams.get(streamId);
  if (!stream) {
    return null;
  }

  let closed = false;
  const subscriber = (event: ChatEvent): void => {
    if (closed) {
      return;
    }
    options.onEvent(event);
    if (event.type === 'final') {
      closed = true;
      stream.subscribers.delete(subscriber);
    }
  };

  options.onEvent({ type: 'open' });
  stream.subscribers.add(subscriber);
  for (const frame of stream.frames) {
    subscriber(frame);
    if (closed) {
      break;
    }
  }
  if (stream.done) {
    closed = true;
  }

  const abort = (): void => {
    closed = true;
    stream.subscribers.delete(subscriber);
  };
  options.signal?.addEventListener('abort', abort, { once: true });

  return {
    get closed() {
      return closed;
    },
  };
}

export function engineStreamIdFromUrl(url: string): string | undefined {
  const match = /\/chat\/stream\/([^/?#]+)/.exec(url);
  return match ? decodeURIComponent(match[1]) : undefined;
}
