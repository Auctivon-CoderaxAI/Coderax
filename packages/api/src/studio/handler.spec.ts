import type { Response } from 'express';
import type { ServerRequest } from '~/types';
import type { StudioGenerationRequest, StudioGenerator } from './types';
import { createStudioGenerateHandler } from './handler';
import { isSafeStudioPath, validateStudioOutput } from './validate';
import { STUDIO_LIMITS } from './types';

jest.mock('@coderax/data-schemas', () => ({
  ...jest.requireActual('@coderax/data-schemas'),
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const project = {
  title: 'Demo',
  entry: 'index.html',
  files: [
    { path: 'index.html', content: '<!doctype html><title>x</title>' },
    { path: 'src/app.css', content: 'body{}' },
  ],
};

function run(options: { generator?: StudioGenerator | null; body?: unknown; enabled?: boolean }) {
  const handler = createStudioGenerateHandler({
    isStudioEnabled: () => options.enabled ?? true,
    generator: options.generator === undefined ? null : options.generator,
    timeoutMs: 50,
  });
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    set: jest.fn(),
    once: jest.fn(),
    writableEnded: false,
    destroyed: false,
  };
  const req = { user: { id: 'u1' }, body: options.body ?? { prompt: 'a todo app' } };
  return handler(req as unknown as ServerRequest, res as unknown as Response).then(() => res);
}

describe('isSafeStudioPath', () => {
  it.each(['index.html', 'src/App.tsx', 'assets/logo.svg'])('accepts %s', (path) => {
    expect(isSafeStudioPath(path)).toBe(true);
  });
  it.each(['../x.html', '/etc/passwd.md', 'a/../b.js', '.env.js', 'run.sh', 'a\\b.js', ''])(
    'rejects %s',
    (path) => expect(isSafeStudioPath(path)).toBe(false),
  );
});

describe('validateStudioOutput', () => {
  it('accepts a bounded project', () => {
    expect(validateStudioOutput(project).files).toHaveLength(2);
  });
  it('rejects a missing entry, duplicates and oversized files', () => {
    expect(() => validateStudioOutput({ ...project, entry: 'nope.html' })).toThrow();
    expect(() =>
      validateStudioOutput({ ...project, files: [...project.files, project.files[0]] }),
    ).toThrow();
    expect(() =>
      validateStudioOutput({
        ...project,
        files: [{ path: 'index.html', content: 'x'.repeat(STUDIO_LIMITS.maxFileBytes + 1) }],
      }),
    ).toThrow();
  });

  // Each file fits the per-file limit, but together they exceed maxTotalBytes.
  it('rejects a project whose total size exceeds the limit', () => {
    const perFile = STUDIO_LIMITS.maxFileBytes;
    const count = Math.floor(STUDIO_LIMITS.maxTotalBytes / perFile) + 1;
    const files = Array.from({ length: count }, (_, i) => ({
      path: i === 0 ? 'index.html' : `part${i}.css`,
      content: 'x'.repeat(perFile),
    }));
    expect(() => validateStudioOutput({ ...project, files })).toThrow('project too large');
  });

  // The file count is bounded independently of byte size.
  it('rejects more than maxFiles files', () => {
    const files = Array.from({ length: STUDIO_LIMITS.maxFiles + 1 }, (_, i) => ({
      path: i === 0 ? 'index.html' : `f${i}.css`,
      content: '',
    }));
    expect(() => validateStudioOutput({ ...project, files })).toThrow('too many files');
  });

  it('accepts exactly maxFiles files', () => {
    const files = Array.from({ length: STUDIO_LIMITS.maxFiles }, (_, i) => ({
      path: i === 0 ? 'index.html' : `f${i}.css`,
      content: '',
    }));
    expect(validateStudioOutput({ ...project, files }).files).toHaveLength(STUDIO_LIMITS.maxFiles);
  });

  // The preview opens the entry, so it must be one of the files and must be HTML.
  it('rejects a non-html entry even when it exists in files', () => {
    expect(() => validateStudioOutput({ ...project, entry: 'src/app.css' })).toThrow(
      'entry must be an html file',
    );
  });

  // Paths that differ only in case would collide on case-insensitive filesystems.
  it('rejects duplicates that differ only by case', () => {
    const files = [
      { path: 'index.html', content: 'a' },
      { path: 'INDEX.HTML', content: 'b' },
    ];
    expect(() => validateStudioOutput({ ...project, files })).toThrow('duplicate path');
  });
});

describe('createStudioGenerateHandler', () => {
  it('is hidden when disabled', async () => {
    expect((await run({ enabled: false })).status).toHaveBeenCalledWith(404);
  });
  it('answers NOT_CONFIGURED without a generator', async () => {
    const res = await run({});
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'NOT_CONFIGURED' }));
  });
  it('rejects an empty prompt', async () => {
    expect((await run({ body: { prompt: ' ' } })).status).toHaveBeenCalledWith(400);
  });
  it('returns validated files', async () => {
    const res = await run({ generator: { generate: jest.fn().mockResolvedValue(project) } });
    expect(res.status).toHaveBeenCalledWith(200);
  });
  it('refuses unsafe generator output without echoing it', async () => {
    const bad = { ...project, files: [{ path: '../evil.html', content: 'x' }] };
    const res = await run({ generator: { generate: jest.fn().mockResolvedValue(bad) } });
    expect(res.status).toHaveBeenCalledWith(502);
    expect(JSON.stringify(res.json.mock.calls)).not.toContain('evil');
  });
  it('times out a slow generator', async () => {
    const generate = jest.fn(() => new Promise<never>(() => undefined));
    expect((await run({ generator: { generate } })).status).toHaveBeenCalledWith(504);
  });

  // When the client disconnects, the generator's signal is aborted and no response is
  // written to the closed socket.
  it('aborts the generator on client disconnect without responding', async () => {
    let signal: AbortSignal | undefined;
    const generate = jest.fn(
      (request: StudioGenerationRequest) =>
        new Promise<never>((_, reject) => {
          signal = request.signal;
          request.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const handler = createStudioGenerateHandler({
      isStudioEnabled: () => true,
      generator: { generate },
      timeoutMs: 5_000,
    });
    let onClose: (() => void) | undefined;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      set: jest.fn(),
      once: jest.fn((event: string, cb: () => void) => {
        if (event === 'close') onClose = cb;
      }),
      writableEnded: false,
      writableFinished: false,
      destroyed: false,
    };
    const req = { user: { id: 'u1' }, body: { prompt: 'a todo app' } };
    const pending = handler(req as unknown as ServerRequest, res as unknown as Response);

    expect(onClose).toBeDefined();
    res.destroyed = true;
    onClose?.();
    await pending;

    expect(signal?.aborted).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});