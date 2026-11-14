import type { Request, Response } from 'express';
import { sanitizeUserForAuthResponse } from './localRefresh';

type UserIdentifier = string | { toString(): string };

interface LocalAutoLoginUser {
  _id: UserIdentifier;
  [key: string]: unknown;
}

interface LocalAutoLoginDependencies {
  getUserById: (userId: string, projection: string) => Promise<LocalAutoLoginUser | null>;
  setAuthTokens: (
    userId: string,
    res: Response,
    session: null,
    req: Request,
  ) => Promise<string>;
  warn: (message: string) => void;
}

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

const isLoopbackRequest = (req: Request): boolean => {
  const remoteAddress = req.socket.remoteAddress;
  return typeof remoteAddress === 'string' && LOOPBACK_ADDRESSES.has(remoteAddress);
};

/**
 * Creates a normal authenticated session for a dedicated local user when explicitly enabled.
 * The raw socket address is checked instead of proxy headers so an external caller cannot opt in.
 */
export function createLocalAutoLoginHandler(deps: LocalAutoLoginDependencies) {
  return async (req: Request, res: Response, userProjection: string): Promise<boolean> => {
    const enabled = process.env.ALLOW_LOCAL_AUTO_LOGIN === 'true';
    const userId = process.env.LOCAL_AUTO_LOGIN_USER_ID?.trim();

    if (!enabled || process.env.NODE_ENV !== 'development' || !userId) {
      return false;
    }
    if (!isLoopbackRequest(req)) {
      deps.warn('[localAutoLogin] Rejected a non-loopback auto-login request');
      return false;
    }

    const user = await deps.getUserById(userId, userProjection);
    if (!user) {
      deps.warn('[localAutoLogin] Configured local user was not found');
      return false;
    }

    const token = await deps.setAuthTokens(userId, res, null, req);
    res.status(200).send({ token, user: sanitizeUserForAuthResponse(user) });
    return true;
  };
}
