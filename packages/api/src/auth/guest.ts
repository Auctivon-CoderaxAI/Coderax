import { randomBytes } from 'node:crypto';
import { SystemRoles } from 'coderax-data-provider';
import type { BalanceConfig, CreateUserRequest } from '@coderax/data-schemas';
import type { Request, Response } from 'express';
import { sanitizeUserForAuthResponse } from './localRefresh';
import { getSafeErrorMetadata } from '~/utils/errors';
import { isEnabled } from '~/utils/common';

type UserId = string | { toString(): string };

interface GuestSessionDependencies {
  createUser: (
    data: CreateUserRequest,
    balance: BalanceConfig | undefined,
    disableTTL: false,
    returnUser: true,
  ) => Promise<{ _id: UserId }>;
  hashPassword: (password: string, rounds: number) => Promise<string>;
  deleteUserById: (id: UserId) => Promise<unknown>;
  getAppConfig: (options: { baseOnly: true }) => Promise<{ balance?: BalanceConfig } | undefined>;
  setAuthTokens: (id: UserId, res: Response, session: null, req: Request) => Promise<string>;
  error: (message: string, metadata: ReturnType<typeof getSafeErrorMetadata>) => void;
  getAccessConfig: () => {
    passwordLoginEnabled: boolean;
    guestAccess?: string;
    enforceTwoFactor?: string;
  };
}

/** Creates a separate expiring USER account for each allowed guest session. */
export function createGuestSessionHandler(
  deps: GuestSessionDependencies,
): (req: Request, res: Response) => Promise<Response> {
  return async (req: Request, res: Response) => {
    const { passwordLoginEnabled, guestAccess, enforceTwoFactor } = deps.getAccessConfig();
    if (passwordLoginEnabled || !isEnabled(guestAccess) || isEnabled(enforceTwoFactor)) {
      return res.sendStatus(404);
    }

    const nonce = randomBytes(16).toString('hex');
    let user: Awaited<ReturnType<GuestSessionDependencies['createUser']>> | undefined;

    try {
      const password = await deps.hashPassword(randomBytes(32).toString('hex'), 10);
      const appConfig = await deps.getAppConfig({ baseOnly: true });
      user = await deps.createUser(
        {
          name: 'Guest',
          username: 'guest_' + nonce,
          email: 'guest-' + nonce + '@guests.invalid',
          emailVerified: true,
          provider: 'guest',
          role: SystemRoles.USER,
          password,
        },
        appConfig?.balance,
        false, // Expire abandoned guest records after one week.
        true,
      );

      const token = await deps.setAuthTokens(user._id, res, null, req);
      return res.status(200).send({ token, user: sanitizeUserForAuthResponse(user) });
    } catch (error) {
      if (user?._id) {
        try {
          await deps.deleteUserById(user._id);
        } catch (cleanupError) {
          deps.error(
            '[guestController] Could not clean up incomplete guest account',
            getSafeErrorMetadata(cleanupError),
          );
        }
      }
      deps.error(
        '[guestController] Could not establish guest session',
        getSafeErrorMetadata(error),
      );
      return res.status(503).json({
        code: 'GUEST_SESSION_UNAVAILABLE',
        message: 'Guest access is temporarily unavailable.',
      });
    }
  };
}
