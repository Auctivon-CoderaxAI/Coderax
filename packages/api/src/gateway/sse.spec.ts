import { SseProtocolError, readSseFrames } from './sse';

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoded = chunks.map((chunk) => new TextEncoder().encode(chunk));
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of encoded) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

async function collect(
  body: unknown,
  options: { idleTimeoutMs?: number; maxFrameBytes?: number; signal?: AbortSignal } = {},
): Promise<string[]> {
  const frames: string[] = [];
  for await (const frame of readSseFrames(body, {
    idleTimeoutMs: options.idleTimeoutMs ?? 1_000,
    ...(options.maxFrameBytes == null ? {} : { maxFrameBytes: options.maxFrameBytes }),
    ...(options.signal == null ? {} : { signal: options.signal }),
  })) {
    frames.push(frame.data);
  }
  return frames;
}

describe('WorkflowEngine SSE reader', () => {
  it('emits every complete frame that arrives in one chunk', async () => {
    const frames = await collect(streamOf(['data: one\n\ndata: two\n\n']));
    expect(frames).toEqual(['one', 'two']);
  });

  it('measures the frame limit in UTF-8 bytes', async () => {
    // 10 two-byte characters is 20 wire bytes, over a 10-byte limit.
    await expect(
      collect(streamOf(['data: éééééééééé\n\n']), { maxFrameBytes: 10 }),
    ).rejects.toBeInstanceOf(SseProtocolError);
  });

  it('rejects an idle stream instead of ending it cleanly', async () => {
    const idle = new ReadableStream<Uint8Array>({});
    await expect(collect(idle, { idleTimeoutMs: 20 })).rejects.toThrow(/went idle/);
  });

  it('wakes a pending read when the caller cancels', async () => {
    const controller = new AbortController();
    const idle = new ReadableStream<Uint8Array>({});
    setTimeout(() => controller.abort(), 10);
    await expect(
      collect(idle, { signal: controller.signal, idleTimeoutMs: 5_000 }),
    ).rejects.toThrow(/cancelled/);
  });

  it('rejects a stream that closes before its frame delimiter', async () => {
    await expect(collect(streamOf(['data: {"incomplete":true}']))).rejects.toThrow(/delimiter/);
  });
});
