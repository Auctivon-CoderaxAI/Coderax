/**
 * Server-side Studio generation seam. Generated files are untrusted data: they are
 * validated and returned, never executed, bundled or served from the app origin.
 */
export const STUDIO_LIMITS = {
  maxPromptLength: 2000,
  maxFiles: 40,
  maxFileBytes: 200_000,
  maxTotalBytes: 1_000_000,
  timeoutMs: 60_000,
} as const;

export const STUDIO_ALLOWED_EXTENSIONS = [
  'html',
  'css',
  'js',
  'jsx',
  'ts',
  'tsx',
  'json',
  'md',
  'svg',
] as const;

export type StudioFile = { path: string; content: string };

export type StudioGenerationRequest = {
  prompt: string;
  userId: string;
  /** `undefined` is the tenantless scope. */
  tenantId?: string;
  signal: AbortSignal;
};

export type StudioGenerationResult = {
  title: string;
  /** Path of the file the preview opens; must be one of `files`. */
  entry: string;
  files: StudioFile[];
};

/** A model-backed adapter (ModelGateway, CyVox, ...). Must not hold browser-visible keys. */
export interface StudioGenerator {
  generate(request: StudioGenerationRequest): Promise<StudioGenerationResult>;
}

export type StudioErrorCode =
  | 'NOT_CONFIGURED'
  | 'INVALID_REQUEST'
  | 'INVALID_OUTPUT'
  | 'TIMEOUT'
  | 'UPSTREAM_ERROR';

export class StudioGenerationError extends Error {
  constructor(public readonly code: StudioErrorCode, message?: string) {
    super(message ?? `Studio generation failed: ${code}`);
    this.name = 'StudioGenerationError';
  }
}