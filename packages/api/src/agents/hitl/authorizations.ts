import { z } from 'zod';
import { logger } from '@coderax/data-schemas';
import {
  STANDING_AUTHORIZATION_MAX_LABEL_LENGTH,
  STANDING_AUTHORIZATION_MAX_PATTERN_LENGTH,
  STANDING_AUTHORIZATION_MAX_TOOLS,
  SystemRoles,
} from 'coderax-data-provider';
import type {
  ToolStandingAuthorizationScope,
  ToolStandingAuthorizationStorage,
} from 'coderax-data-provider';
import type { Request, Response } from 'express';

export type OwnerRequest = Request<Record<string, string | undefined>> & {
  user?: { id?: string; role?: string; tenantId?: string };
};

export type ToolStandingAuthorizationController = (
  req: OwnerRequest,
  res: Response,
) => Promise<void>;

export interface ToolStandingAuthorizationControllers {
  list: ToolStandingAuthorizationController;
  create: ToolStandingAuthorizationController;
  revoke: ToolStandingAuthorizationController;
}

const createSchema = z
  .object({
    label: z.string().min(1).max(STANDING_AUTHORIZATION_MAX_LABEL_LENGTH),
    tools: z
      .array(z.string().min(1).max(STANDING_AUTHORIZATION_MAX_PATTERN_LENGTH))
      .min(1)
      .max(STANDING_AUTHORIZATION_MAX_TOOLS),
    destinations: z
      .array(z.string().min(1).max(STANDING_AUTHORIZATION_MAX_PATTERN_LENGTH))
      .optional(),
    projectId: z.string().min(1).max(STANDING_AUTHORIZATION_MAX_PATTERN_LENGTH).optional(),
    expiresAt: z.number().int().positive().optional(),
    /** Accepted as a number so a non-zero ceiling is refused with its own explanation. */
    maxCostUsd: z.number().finite().optional(),
  })
  .strict();

export interface ToolStandingAuthorizationDependencies {
  storage: Pick<
    ToolStandingAuthorizationStorage,
    | 'listToolStandingAuthorizations'
    | 'createToolStandingAuthorization'
    | 'revokeToolStandingAuthorization'
  >;
}

/**
 * Management endpoints for standing authorizations.
 *
 * The grant is what lets a run skip a prompt, so only the owner may write one.
 * Every handler scopes the store to the authenticated user: another user's grant
 * is invisible rather than merely uneditable.
 */
export function createToolStandingAuthorizationControllers({
  storage,
}: ToolStandingAuthorizationDependencies): ToolStandingAuthorizationControllers {
  function authorize(req: OwnerRequest, res: Response): ToolStandingAuthorizationScope | null {
    if (!req.user?.id) {
      res.status(401).json({ code: 'UNAUTHORIZED' });
      return null;
    }
    if (req.user.role !== SystemRoles.ADMIN) {
      res.status(403).json({ code: 'STANDING_AUTHORIZATION_FORBIDDEN' });
      return null;
    }
    return {
      userId: req.user.id,
      ...(req.user.tenantId != null ? { tenantId: req.user.tenantId } : {}),
    };
  }

  async function list(req: OwnerRequest, res: Response): Promise<void> {
    const scope = authorize(req, res);
    if (!scope) return;
    try {
      res.status(200).json({ authorizations: await storage.listToolStandingAuthorizations(scope) });
    } catch (error) {
      logger.warn(`[Standing authorizations] List failed: ${(error as Error).message}`);
      res.status(503).json({ code: 'STANDING_AUTHORIZATION_FAILED' });
    }
  }

  async function create(req: OwnerRequest, res: Response): Promise<void> {
    const scope = authorize(req, res);
    if (!scope) return;
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: 'INVALID_STANDING_AUTHORIZATION' });
      return;
    }
    try {
      const created = await storage.createToolStandingAuthorization(scope, parsed.data);
      if (!created.ok) {
        res.status(400).json({
          code: 'INVALID_STANDING_AUTHORIZATION',
          detail: created.error.message,
        });
        return;
      }
      res.status(201).json({ authorization: created.value });
    } catch (error) {
      logger.warn(`[Standing authorizations] Create failed: ${(error as Error).message}`);
      res.status(503).json({ code: 'STANDING_AUTHORIZATION_FAILED' });
    }
  }

  async function revoke(req: OwnerRequest, res: Response): Promise<void> {
    const scope = authorize(req, res);
    if (!scope) return;
    const authorizationId = req.params.authorizationId;
    if (!authorizationId) {
      res.status(400).json({ code: 'INVALID_STANDING_AUTHORIZATION' });
      return;
    }
    try {
      const revoked = await storage.revokeToolStandingAuthorization(scope, authorizationId);
      if (!revoked) {
        res.status(404).json({ code: 'STANDING_AUTHORIZATION_NOT_FOUND' });
        return;
      }
      res.status(200).json({ revoked: true });
    } catch (error) {
      logger.warn(`[Standing authorizations] Revoke failed: ${(error as Error).message}`);
      res.status(503).json({ code: 'STANDING_AUTHORIZATION_FAILED' });
    }
  }

  return { list, create, revoke };
}
