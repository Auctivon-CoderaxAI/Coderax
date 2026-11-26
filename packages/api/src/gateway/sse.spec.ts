import { readSseFrames, SseFramingError, SseProtocolError } from './sse';

function frames(chunks: string[], maxFrameBytes = 16) {
  return readSseFrames(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    }),
    { idleTimeoutMs: 1000, maxFrameBytes },
  )[Symbol.asyncIterator]();
}

it('bounds individual frames and accepts multiple valid frames in one chunk', async () => {
  const iterator = frames(['data: 1234567890\n\ndata: 1234567890\n\ndata: 1234567890\n', '\n']);
  for (let i = 0; i < 3; i++) {
    await expect(iterator.next()).resolves.toEqual({ done: false, value: { data: '1234567890' } });
  }
  await expect(iterator.next()).resolves.toMatchObject({ done: true });
});

it.each(['', '\n\n'])('rejects a frame over its UTF-8 byte limit (suffix %j)', async (suffix) => {
  await expect(frames(['data: €€€€' + suffix]).next()).rejects.toBeInstanceOf(SseProtocolError);
});

it('does not yield an event body missing its final delimiter', async () => {
  await expect(frames(['data: unfinished']).next()).rejects.toBeInstanceOf(SseFramingError);
});
