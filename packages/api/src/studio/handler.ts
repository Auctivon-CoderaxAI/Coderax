import { logger } from '@coderax/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types';
import type { StudioErrorCode, StudioGenerator } from './types';
import { STUDIO_LIMITS, StudioGenerationError } from './types';
import { validateStudioOutput } from './validate';
import { getSafeErrorMetadata } from '~/utils';

const STATUS: Record<StudioErrorCode, number> = {
  NOT_CONFIGURED: 503,
  INVALID_REQUEST: 400,
  INVALID_OUTPUT: 502,
  TIMEOUT: 504,
  UPSTREAM_ERROR: 502,
};

const MESSAGES: Record<StudioErrorCode, string> = {
  NOT_CONFIGURED: 'Studio generation is not configured',
  INVALID_REQUEST: 'Invalid Studio request',
  INVALID_OUTPUT: 'The generator returned a project that failed validation',
  TIMEOUT: 'Studio generation timed out',
  UPSTREAM_ERROR: 'Studio generation is unavailable',
};

function sendError(res: Response, code: StudioErrorCode): void {
  res.status(STATUS[code]).json({ error: MESSAGES[code], code });
}

export type StudioHandlerDeps = {
  isStudioEnabled: () => boolean;
  /** `null` until a backend-authorized model adapter is wired in. */
  generator: StudioGenerator | null;
  timeoutMs?: number;
};

/**
 * POST /api/studio/generate. Returns validated multi-file output as data. Upstream text
 * is never echoed to the client; failures answer with a stable code.
 */
export function createStudioGenerateHandler({
  isStudioEnabled,
  generator,
  timeoutMs = STUDIO_LIMITS.timeoutMs,
}: StudioHandlerDeps) {
  return async (req: ServerRequest, res: Response): Promise<void> => {
    res.set('Cache-Control', 'private, no-store');
    if (!isStudioEnabled()) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const prompt = (req.body as { prompt?: unknown } | undefined)?.prompt;
    if (
      typeof prompt !== 'string' ||
      prompt.trim() === '' ||
      prompt.length > STUDIO_LIMITS.maxPromptLength
    ) {
      sendError(res, 'INVALID_REQUEST');
      return;
    }
    if (!generator) {
      sendError(res, 'NOT_CONFIGURED');
      return;
    }

    const controller = new AbortController();
    res.once('close', () => {
      if (!res.writableFinished) controller.abort();
    });
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new StudioGenerationError('TIMEOUT'));
      }, timeoutMs);
    });

    try {
      const output = await Promise.race([
        generator.generate({
          prompt: prompt.trim(),
          userId,
          tenantId: req.user?.tenantId || undefined,
          signal: controller.signal,
        }),
        timeout,
      ]);
      res.status(200).json({ project: validateStudioOutput(output) });
    } catch (error) {
      if (res.writableEnded || res.destroyed) return;
      const code = error instanceof StudioGenerationError ? error.code : 'UPSTREAM_ERROR';
      logger.warn(`[Studio] Generation failed (${code})`, getSafeErrorMetadata(error));
      sendError(res, code);
    } finally {
      clearTimeout(timer);
    }
  };
}