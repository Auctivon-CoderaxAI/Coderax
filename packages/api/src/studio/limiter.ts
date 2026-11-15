import { rateLimit } from 'express-rate-limit';
import type { Store } from 'express-rate-limit';
import type { RequestHandler } from 'express';
import type { ServerRequest } from '~/types/http';

const DEFAULT_USER_MAX = 10;
const DEFAULT_USER_WINDOW_MINUTES = 1;
const TENANTLESS = '~tenantless';

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return value != null && value.trim() !== '' && Number.isFinite(parsed) && parsed > 0
    ? parsed
    : fallback;
}

export function getStudioGenerateUserMax(): number {
  const max = Math.floor(
    positiveNumber(process.env.STUDIO_GENERATE_USER_MAX, DEFAULT_USER_MAX),
  );
  return max >= 1 ? max : DEFAULT_USER_MAX;
}

export function getStudioGenerateUserWindowMs(): number {
  return (
    positiveNumber(process.env.STUDIO_GENERATE_USER_WINDOW, DEFAULT_USER_WINDOW_MINUTES) *
    60 *
    1000
  );
}

/**
 * Per-user budget for Studio generations, which spend model quota. Must run after
 * JWT auth so every bucket belongs to an authenticated user.
 */
export function createStudioGenerateLimiter({
  store,
}: {
  /** Shared counter store (e.g. Redis) from the caller; omitted, counts stay in this process. */
  store?: Store;
} = {}): RequestHandler {
  return rateLimit({
    windowMs: getStudioGenerateUserWindowMs(),
    limit: getStudioGenerateUserMax(),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        error: 'Too many Studio generation requests. Try again shortly.',
        code: 'RATE_LIMITED',
      });
    },
    /** Tenants can share one store, so a user's bucket is named within their tenant. */
    keyGenerator: (req) => {
      const user = (req as ServerRequest).user;
      const userId = String(user?.id ?? user?._id?.toString() ?? '');
      return `${user?.tenantId || TENANTLESS}:${userId}`;
    },
    store,
  });
}