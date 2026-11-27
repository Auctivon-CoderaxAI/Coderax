import type { NextFunction, Request, Response } from 'express';

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Copies the standard `Idempotency-Key` header onto the body field the
 * generation controller already deduplicates by.
 *
 * A client that loses the start response retries the same POST. With a key, the
 * controller resolves that retry to the live generation and returns
 * `{ status: 'resumed' }` instead of starting a second one. A malformed key
 * fails closed: silently ignoring it would turn the retry into a new run.
 */
export function idempotencyKeyAs(field: string, options: { header?: string } = {}) {
  const header = options.header ?? 'idempotency-key';
  return function idempotencyKeyMiddleware(req: Request, res: Response, next: NextFunction): void {
    const value = req.get(header);
    if (value == null || value.length === 0) {
      next();
      return;
    }
    if (!IDEMPOTENCY_KEY_PATTERN.test(value)) {
      res.status(400).json({
        code: 'WORK_IDEMPOTENCY_KEY_INVALID',
        error: 'Idempotency-Key must be 1-128 characters of [A-Za-z0-9._:-].',
      });
      return;
    }
    const body = req.body as Record<string, unknown> | undefined;
    if (body != null && typeof body === 'object' && body[field] == null) {
      body[field] = value;
    }
    next();
  };
}
