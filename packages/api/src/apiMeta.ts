import express from 'express';
import type { NextFunction, Request, Response, Router } from 'express';
import {
  CODERAX_API_VERSION,
  CODERAX_API_VERSION_HEADER,
  describeApiContract,
  shouldRejectApiRequest,
} from './apiContract';

/**
 * The declared contract, so a client reads its version and capabilities once
 * instead of probing routes. Nothing here is per-user or secret.
 */
export function createApiMetaRouter(
  options: { commit?: string | null; experimental?: boolean } = {},
): Router {
  const router = express.Router();
  router.get('/', (_req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    const metadata = describeApiContract({ commit: options.commit ?? null });
    res
      .status(200)
      .json(
        options.experimental
          ? { ...metadata, capabilities: { repos: metadata.capabilities.repos } }
          : metadata,
      );
  });
  return router;
}

/** Every API response names the version that served it. */
export function apiVersionHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.set(CODERAX_API_VERSION_HEADER, String(CODERAX_API_VERSION));
  res.vary(CODERAX_API_VERSION_HEADER);
  next();
}

/**
 * A write from another major cannot be interpreted safely, so it is refused
 * before a handler reads the body. Reads and unversioned (legacy) clients pass.
 */
export function rejectUnsupportedApiVersion(req: Request, res: Response, next: NextFunction): void {
  const advertised = req.get(CODERAX_API_VERSION_HEADER);
  if (shouldRejectApiRequest(req.method, advertised)) {
    res.status(426).json({
      code: 'API_VERSION_UNSUPPORTED',
      apiVersion: CODERAX_API_VERSION,
      error: `This server implements API major ${CODERAX_API_VERSION}.`,
    });
    return;
  }
  next();
}
