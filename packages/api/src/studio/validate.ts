import { STUDIO_ALLOWED_EXTENSIONS, STUDIO_LIMITS, StudioGenerationError } from './types';
import type { StudioFile, StudioGenerationResult } from './types';

const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}$/;
const MAX_PATH_LENGTH = 200;
const MAX_TITLE_LENGTH = 120;

/** Relative, forward-slash, no traversal, no hidden files, allowlisted extension. */
export function isSafeStudioPath(path: unknown): path is string {
  if (typeof path !== 'string' || path.length === 0 || path.length > MAX_PATH_LENGTH) {
    return false;
  }
  const segments = path.split('/');
  if (!segments.every((segment) => SEGMENT.test(segment) && !segment.includes('..'))) {
    return false;
  }
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return (STUDIO_ALLOWED_EXTENSIONS as readonly string[]).includes(extension);
}

/** Rejects (never repairs) model output that breaks any bound. */
export function validateStudioOutput(output: unknown): StudioGenerationResult {
  const fail = (reason: string): never => {
    throw new StudioGenerationError('INVALID_OUTPUT', reason);
  };
  if (!output || typeof output !== 'object') fail('output is not an object');
  const { title, entry, files } = output as Partial<StudioGenerationResult>;

  if (typeof title !== 'string' || title.trim() === '') fail('missing title');
  if (!Array.isArray(files) || files.length === 0) fail('no files');
  if ((files as unknown[]).length > STUDIO_LIMITS.maxFiles) fail('too many files');

  const seen = new Set<string>();
  let totalBytes = 0;
  const clean: StudioFile[] = [];
  for (const file of files as unknown[]) {
    const { path, content } = (file ?? {}) as Partial<StudioFile>;
    if (!isSafeStudioPath(path)) fail('unsafe path');
    if (typeof content !== 'string') fail('non-text content');
    const key = (path as string).toLowerCase();
    if (seen.has(key)) fail('duplicate path');
    seen.add(key);
    const bytes = Buffer.byteLength(content as string, 'utf8');
    if (bytes > STUDIO_LIMITS.maxFileBytes) fail('file too large');
    totalBytes += bytes;
    if (totalBytes > STUDIO_LIMITS.maxTotalBytes) fail('project too large');
    clean.push({ path: path as string, content: content as string });
  }

  if (typeof entry !== 'string' || !seen.has(entry.toLowerCase())) fail('entry not in files');
  if (!/\.html$/i.test(entry as string)) fail('entry must be an html file');

  return {
    title: (title as string).trim().slice(0, MAX_TITLE_LENGTH),
    entry: entry as string,
    files: clean,
  };
}