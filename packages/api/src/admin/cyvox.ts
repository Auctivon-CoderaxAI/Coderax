import { PrincipalModel, PrincipalType } from 'coderax-data-provider';
import { BASE_CONFIG_PRINCIPAL_ID, logger } from '@coderax/data-schemas';
import type {
  TCyVoxConnectionStatus,
  TCyVoxConnectionTestResponse,
  TCyVoxProbeRecord,
} from 'coderax-data-provider';
import type { IConfig } from '@coderax/data-schemas';
import type { ClientSession, Types } from 'mongoose';
import type { Response } from 'express';
import type { CyvoxEnvironment, CyvoxTarget } from '~/cyvox/settings';
import type { ServerRequest } from '~/types/http';
import {
  buildCyvoxConnectionStatus,
  buildCyvoxUpdateFields,
  normalizeCyvoxBaseUrl,
  readStoredCyvox,
  requiresAuthToken,
  resolveCyvoxTarget,
  verifyCyvoxEndpoint,
  buildProbeFields,
  toProbeRecord,
} from '~/cyvox/settings';
import { encryptConfigSecretFields, resolveConfigSecret } from './secrets';

const DEFAULT_PRIORITY = 10;
const ENCRYPTED_PREFIX = 'v3:';
const MAX_TOKEN_LENGTH = 4096;
const INVALID_ORIGIN =
  'baseUrl must be an origin without a path, credentials, query or fragment; https is required except for loopback hosts';

export interface AdminCyVoxDeps {
  findConfigByPrincipal: (
    principalType: PrincipalType,
    principalId: string | Types.ObjectId,
    options?: { includeInactive?: boolean },
    session?: ClientSession,
  ) => Promise<IConfig | null>;
  patchConfigFields: (
    principalType: PrincipalType,
    principalId: string | Types.ObjectId,
    principalModel: PrincipalModel,
    fields: Record<string, unknown>,
    priority: number,
    session?: ClientSession,
  ) => Promise<IConfig | null>;
  toggleConfigActive: (
    principalType: PrincipalType,
    principalId: string | Types.ObjectId,
    isActive: boolean,
    session?: ClientSession,
  ) => Promise<IConfig | null>;
  invalidateConfigCaches?: (tenantId?: string) => Promise<void>;
  /** Deployment-level fallback, read once by the route wiring. */
  environment: CyvoxEnvironment;
}

function getTenantId(req: ServerRequest): string | undefined {
  return (req.user as { tenantId?: string } | undefined)?.tenantId;
}

function storedToken(stored: ReturnType<typeof readStoredCyvox>): string | undefined {
  const resolved = resolveConfigSecret(stored?.authToken);
  return resolved?.trim() || undefined;
}

/**
 * Admin handlers for the tenant-wide Coderax Work (CyVox) connection.
 *
 * The connection lives on the base config so every administrator manages one
 * integration. The bearer token is encrypted at rest and never returned; reads
 * expose only non-secret metadata. Environment variables remain a fallback used
 * when no connection has been saved.
 */
export function createAdminCyVoxHandlers(deps: AdminCyVoxDeps): {
  getConnection: (req: ServerRequest, res: Response) => Promise<Response>;
  updateConnection: (req: ServerRequest, res: Response) => Promise<Response>;
  testConnection: (req: ServerRequest, res: Response) => Promise<Response>;
} {
  const { findConfigByPrincipal, patchConfigFields, toggleConfigActive, invalidateConfigCaches } =
    deps;

  function findBaseConfig(options?: { includeInactive?: boolean }): Promise<IConfig | null> {
    return options
      ? findConfigByPrincipal(PrincipalType.ROLE, BASE_CONFIG_PRINCIPAL_ID, options)
      : findConfigByPrincipal(PrincipalType.ROLE, BASE_CONFIG_PRINCIPAL_ID);
  }

  /**
   * Records what the saved connection answered so the settings screen can show
   * the last known state. A failed write must not turn a successful check into
   * an error the administrator cannot act on, so it is logged and dropped.
   */
  async function persistProbe(record: TCyVoxProbeRecord): Promise<void> {
    try {
      const existing = await findBaseConfig({ includeInactive: true });
      await patchConfigFields(
        PrincipalType.ROLE,
        BASE_CONFIG_PRINCIPAL_ID,
        PrincipalModel.ROLE,
        buildProbeFields(record),
        existing?.priority ?? DEFAULT_PRIORITY,
      );
    } catch (error) {
      logger.warn('[adminCyVox] Failed to record the connection check', error);
    }
  }

  function statusFor(
    config: IConfig | null,
    fallbackStored?: ReturnType<typeof readStoredCyvox>,
  ): TCyVoxConnectionStatus {
    return buildCyvoxConnectionStatus({
      stored: readStoredCyvox(config) ?? fallbackStored,
      environment: deps.environment,
      updatedAt: config?.updatedAt ? new Date(config.updatedAt).toISOString() : undefined,
    });
  }

  async function getConnection(_req: ServerRequest, res: Response): Promise<Response> {
    try {
      return res.status(200).json(statusFor(await findBaseConfig()));
    } catch (error) {
      logger.error('[adminCyVox] getConnection error:', error);
      return res.status(500).json({ error: 'Failed to read Coderax Work connection' });
    }
  }

  async function updateConnection(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const body = (req.body ?? {}) as {
        enabled?: unknown;
        baseUrl?: unknown;
        authToken?: unknown;
      };
      const enabled = body.enabled === true;
      const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
      const submittedToken = typeof body.authToken === 'string' ? body.authToken.trim() : '';

      if (!baseUrl) {
        return res.status(400).json({ error: 'baseUrl is required' });
      }
      const url = normalizeCyvoxBaseUrl(baseUrl);
      if (!url) {
        return res.status(400).json({ error: INVALID_ORIGIN });
      }
      if (submittedToken.startsWith(ENCRYPTED_PREFIX)) {
        return res.status(400).json({ error: 'Encrypted authToken values cannot be submitted' });
      }
      if (submittedToken.length > MAX_TOKEN_LENGTH) {
        return res.status(400).json({ error: 'authToken is too long' });
      }

      const existing = await findBaseConfig({ includeInactive: true });
      const stored = readStoredCyvox(existing);
      const origin = url.origin;
      const originChanged = stored?.baseUrl !== origin;
      const existingToken = storedToken(stored);

      if (!submittedToken) {
        if (originChanged) {
          return res
            .status(400)
            .json({ error: 'authToken is required when changing the service URL' });
        }
        if (!existingToken && requiresAuthToken(url)) {
          return res
            .status(400)
            .json({ error: 'authToken is required for a remote Coderax Work service' });
        }
      }

      const update = buildCyvoxUpdateFields({
        enabled,
        baseUrl: origin,
        authToken: submittedToken || undefined,
      });
      if (!update) {
        return res.status(400).json({ error: INVALID_ORIGIN });
      }

      let updated = await patchConfigFields(
        PrincipalType.ROLE,
        BASE_CONFIG_PRINCIPAL_ID,
        PrincipalModel.ROLE,
        encryptConfigSecretFields(update.fields),
        existing?.priority ?? DEFAULT_PRIORITY,
      );
      if (updated?.isActive === false) {
        updated = await toggleConfigActive(PrincipalType.ROLE, BASE_CONFIG_PRINCIPAL_ID, true);
      }

      invalidateConfigCaches?.(getTenantId(req))?.catch((err) =>
        logger.error('[adminCyVox] Cache invalidation failed after update:', err),
      );

      const fallbackStored = {
        ...stored,
        enabled,
        baseUrl: origin,
        authToken: submittedToken || stored?.authToken,
        authTokenPreview: update.preview || stored?.authTokenPreview,
      };
      return res.status(200).json(statusFor(updated ?? existing, fallbackStored));
    } catch (error) {
      logger.error('[adminCyVox] updateConnection error:', error);
      return res.status(500).json({ error: 'Failed to update Coderax Work connection' });
    }
  }

  async function testConnection(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const body = (req.body ?? {}) as { baseUrl?: unknown; authToken?: unknown };
      const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
      const submittedToken = typeof body.authToken === 'string' ? body.authToken.trim() : '';

      let target: CyvoxTarget | null;
      if (baseUrl) {
        const url = normalizeCyvoxBaseUrl(baseUrl);
        if (!url) {
          return res.status(400).json({ error: INVALID_ORIGIN });
        }
        const stored = readStoredCyvox(await findBaseConfig());
        const token =
          submittedToken || (stored?.baseUrl === url.origin ? (storedToken(stored) ?? '') : '');
        if (!token && requiresAuthToken(url)) {
          const failed: TCyVoxConnectionTestResponse = {
            success: false,
            errorCode: 'missing_configuration',
          };
          return res.status(200).json(failed);
        }
        target = { url, authToken: token || undefined, source: 'settings' };
      } else {
        const stored = readStoredCyvox(await findBaseConfig());
        target = resolveCyvoxTarget({ stored, environment: deps.environment });
      }

      if (!target) {
        const failed: TCyVoxConnectionTestResponse = {
          success: false,
          errorCode: 'missing_configuration',
        };
        return res.status(200).json(failed);
      }

      const result = await verifyCyvoxEndpoint(target);
      /** Only the saved connection keeps a last-check record; testing a draft leaves nothing behind. */
      if (!baseUrl && target.source === 'settings') {
        await persistProbe(toProbeRecord(result));
      }
      return res.status(200).json(result);
    } catch (error) {
      logger.error('[adminCyVox] testConnection error:', error);
      const failed: TCyVoxConnectionTestResponse = {
        success: false,
        errorCode: 'unreachable',
      };
      return res.status(200).json(failed);
    }
  }

  return { getConnection, updateConnection, testConnection };
}
