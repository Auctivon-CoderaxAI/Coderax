import { z } from 'zod';
import { CONTRACT_VERSION } from './contracts';

/**
 * The gateway is a server-side adapter, never a browser client. Its credential
 * is the *name* of an environment variable; the value is read from the process
 * environment at call time and never appears in config, a response or a log.
 */
export type GatewayAuthorityMode = 'native' | 'engine';

export type GatewayConfig = {
  enabled: boolean;
  baseUrl?: string;
  tokenEnv: string;
  contractVersion: string;
  timeoutMs: number;
  healthTtlMs: number;
  /** `native` keeps the in-repository engine authoritative for every conversation. */
  authority: GatewayAuthorityMode;
  /** Conversations explicitly served by the external engine. */
  engineConversations: string[];
  /** Conversations explicitly kept on the in-repository engine (rollback wins). */
  nativeConversations: string[];
};

export class GatewayConfigurationError extends Error {
  readonly code = 'GATEWAY_CONFIGURATION';

  constructor(message: string) {
    super(message);
    this.name = 'GatewayConfigurationError';
  }
}

const conversationList = z.array(z.string().trim().min(1).max(128)).max(500);

const gatewayConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    baseUrl: z.string().trim().max(2048).optional(),
    tokenEnv: z.string().trim().min(1).max(128).optional(),
    contractVersion: z.string().trim().min(1).max(32).optional(),
    timeoutMs: z.number().int().min(100).max(120_000).optional(),
    healthTtlMs: z.number().int().min(0).max(300_000).optional(),
    authority: z.enum(['native', 'engine']).optional(),
    engineConversations: conversationList.optional(),
    nativeConversations: conversationList.optional(),
  })
  .strict();

const DEFAULTS: GatewayConfig = Object.freeze({
  enabled: false,
  tokenEnv: 'WORKFLOW_ENGINE_TOKEN',
  contractVersion: CONTRACT_VERSION,
  timeoutMs: 30_000,
  healthTtlMs: 15_000,
  authority: 'native',
  engineConversations: [],
  nativeConversations: [],
});

/** Loopback and private-network origins are allowed for development; the protocol must be HTTP(S). */
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Resolves the gateway section of the app config. Unknown keys are refused so a
 * typo cannot silently disable a safety control, and a conversation may not be
 * claimed by both transports.
 */
export function resolveGatewayConfig(raw: unknown): GatewayConfig {
  if (raw == null) {
    return { ...DEFAULTS, engineConversations: [], nativeConversations: [] };
  }

  const parsed = gatewayConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new GatewayConfigurationError(`gateway configuration is invalid (${fields || 'shape'})`);
  }

  const input = parsed.data;
  if (input.baseUrl != null && input.baseUrl.length > 0 && !isHttpUrl(input.baseUrl)) {
    throw new GatewayConfigurationError('gateway.baseUrl must be an http(s) URL');
  }
  if (input.contractVersion != null && input.contractVersion !== CONTRACT_VERSION) {
    throw new GatewayConfigurationError(
      `gateway.contractVersion ${input.contractVersion} is not supported by this deployment (${CONTRACT_VERSION})`,
    );
  }

  const engineConversations = [...(input.engineConversations ?? [])];
  const nativeConversations = [...(input.nativeConversations ?? [])];
  const overlap = engineConversations.filter((id) => nativeConversations.includes(id));
  if (overlap.length > 0) {
    throw new GatewayConfigurationError(
      `gateway conversations may not be assigned to both transports (${overlap.length} conflict${overlap.length === 1 ? '' : 's'})`,
    );
  }

  return {
    enabled: input.enabled ?? DEFAULTS.enabled,
    ...(input.baseUrl != null && input.baseUrl.length > 0 ? { baseUrl: input.baseUrl } : {}),
    tokenEnv: input.tokenEnv ?? DEFAULTS.tokenEnv,
    contractVersion: input.contractVersion ?? DEFAULTS.contractVersion,
    timeoutMs: input.timeoutMs ?? DEFAULTS.timeoutMs,
    healthTtlMs: input.healthTtlMs ?? DEFAULTS.healthTtlMs,
    authority: input.authority ?? DEFAULTS.authority,
    engineConversations,
    nativeConversations,
  };
}

/** The token itself never leaves this function. */
export function readGatewayToken(
  config: GatewayConfig,
  env: NodeJS.ProcessEnv,
): string | undefined {
  const token = env[config.tokenEnv];
  if (typeof token !== 'string' || token.trim().length === 0) {
    return undefined;
  }
  return token;
}
