import type {
  EngineCapabilities,
  GatewayCapability,
  HealthReport,
  ReadinessReport,
} from './contracts';
import type { EngineHttpClient } from './client';
import type { GatewayResult } from './errors';
import {
  CONTRACT_VERSION,
  EVENT_SCHEMA_VERSION,
  HealthReport as HealthReportSchema,
  ReadinessReport as ReadinessReportSchema,
  ENGINE_ROUTES,
} from './contracts';
import { fail, gatewayError, ok } from './errors';

/**
 * Version and capability negotiation.
 *
 * The gateway refuses to serve an owner operation unless it has recently seen a
 * compatible engine: the health report must parse against contract 1.0.0 and the
 * engine must report itself ready. Per-operation capabilities are derived from
 * the engines' own capability flags, never assumed, so an engine that cannot
 * cancel reports `cancel: false` and the gateway refuses instead of forwarding a
 * request the engine never promised to honor.
 */

export type CapabilitySnapshot = {
  compatible: boolean;
  contractVersion: typeof CONTRACT_VERSION;
  eventSchemaVersion: typeof EVENT_SCHEMA_VERSION;
  ready: boolean;
  checkedAt: string;
  engines: HealthReport['engines'];
  health: HealthReport;
  readiness: ReadinessReport;
  capabilities: Record<GatewayCapability, boolean>;
  unavailable: GatewayCapability[];
};

export type CapabilityNegotiation = {
  snapshot: (options?: { force?: boolean }) => Promise<GatewayResult<CapabilitySnapshot>>;
  lastKnown: () => GatewayResult<CapabilitySnapshot> | null;
  invalidate: () => void;
  contractVersion: typeof CONTRACT_VERSION;
};

export type NegotiationOptions = {
  client: EngineHttpClient;
  ttlMs?: number;
  now?: () => Date;
};

const ALL_CAPABILITIES: readonly GatewayCapability[] = [
  'chat',
  'streaming',
  'work',
  'events',
  'cancel',
  'resume',
  'retry',
  'conversations',
  'memory',
  'permissions',
  'notifications',
  'discovery',
  'artifacts',
  'scheduling',
];

function unionCapabilities(engines: HealthReport['engines']): EngineCapabilities {
  const union: EngineCapabilities = {
    streaming: false,
    tools: false,
    cancellation: false,
    resume: false,
    modelSelection: false,
    durable: false,
  };
  for (const engine of engines) {
    for (const key of Object.keys(union) as Array<keyof EngineCapabilities>) {
      if (engine.capabilities[key]) {
        union[key] = true;
      }
    }
  }
  return union;
}

export function deriveCapabilities(
  engines: HealthReport['engines'],
): Record<GatewayCapability, boolean> {
  const union = unionCapabilities(engines);
  const capabilities: Record<GatewayCapability, boolean> = {
    chat: true,
    streaming: union.streaming,
    work: true,
    events: true,
    cancel: union.cancellation,
    resume: union.resume,
    retry: union.durable,
    conversations: true,
    memory: true,
    permissions: true,
    notifications: true,
    discovery: true,
    // Artifacts are projected from an authoritative task status; no engine route
    // exists for artifact transfer, so the gateway only ever exposes read-only
    // descriptors that the engine already reported.
    artifacts: true,
    // The WorkflowEngine contract 1.0.0 publishes no scheduling operation.
    // Scheduling therefore stays on the in-repository scheduler and this gateway
    // fails closed rather than inventing a route.
    scheduling: false,
  };
  return capabilities;
}

export function createCapabilityNegotiation(options: NegotiationOptions): CapabilityNegotiation {
  const ttlMs = options.ttlMs ?? 15_000;
  const now = options.now ?? (() => new Date());
  let cached: { expiresAt: number; result: GatewayResult<CapabilitySnapshot> } | null = null;

  async function read(): Promise<GatewayResult<CapabilitySnapshot>> {
    const healthRoute = ENGINE_ROUTES.getHealth;
    const healthCall = await options.client.call({
      operation: 'getHealth',
      path: healthRoute.path,
      method: 'GET',
    });
    if (!healthCall.ok) {
      return fail(healthCall.error);
    }
    if (healthCall.value.kind !== 'json') {
      return fail(
        gatewayError('contract_mismatch', {
          detail: 'the engine answered the health operation with a stream',
        }),
      );
    }
    const health = HealthReportSchema.safeParse(healthCall.value.body);
    if (!health.success) {
      return fail(
        gatewayError('contract_mismatch', {
          detail: `the engine health report does not match contract ${CONTRACT_VERSION}`,
        }),
      );
    }

    const readinessRoute = ENGINE_ROUTES.getReadiness;
    const readinessCall = await options.client.call({
      operation: 'getReadiness',
      path: readinessRoute.path,
      method: 'GET',
    });
    if (!readinessCall.ok) {
      return fail(readinessCall.error);
    }
    if (readinessCall.value.kind !== 'json') {
      return fail(
        gatewayError('contract_mismatch', {
          detail: 'the engine answered the readiness operation with a stream',
        }),
      );
    }
    const readiness = ReadinessReportSchema.safeParse(readinessCall.value.body);
    if (!readiness.success) {
      return fail(
        gatewayError('contract_mismatch', {
          detail: `the engine readiness report does not match contract ${CONTRACT_VERSION}`,
        }),
      );
    }

    if (!readiness.data.ready) {
      return fail(
        gatewayError('not_ready', {
          detail: `the engine reports ${readiness.data.missing.length} missing dependency check(s)`,
          retryable: true,
        }),
      );
    }
    if (health.data.status === 'failed') {
      return fail(
        gatewayError('engine_unavailable', {
          detail: 'the engine reports a failed required dependency',
          retryable: true,
        }),
      );
    }

    const capabilities = deriveCapabilities(health.data.engines);
    const unavailable = ALL_CAPABILITIES.filter((capability) => !capabilities[capability]);

    return ok({
      compatible: true,
      contractVersion: CONTRACT_VERSION,
      eventSchemaVersion: EVENT_SCHEMA_VERSION,
      ready: true,
      checkedAt: now().toISOString(),
      engines: health.data.engines,
      health: health.data,
      readiness: readiness.data,
      capabilities,
      unavailable,
    });
  }

  return {
    contractVersion: CONTRACT_VERSION,
    snapshot: async (snapshotOptions) => {
      if (!snapshotOptions?.force && cached != null && cached.expiresAt > now().getTime()) {
        return cached.result;
      }
      const result = await read();
      cached = {
        expiresAt: now().getTime() + (result.ok ? ttlMs : Math.min(ttlMs, 5_000)),
        result,
      };
      return result;
    },
    lastKnown: () => cached?.result ?? null,
    invalidate: () => {
      cached = null;
    },
  };
}

/**
 * Validates the client's declared contract version. A client that was built
 * against another major/minor contract is refused by name instead of being
 * served a shape it does not understand.
 */
export function assertClientContractVersion(
  declared: string | undefined,
  requestId: string,
): GatewayResult<typeof CONTRACT_VERSION> {
  if (declared == null || declared.trim().length === 0) {
    return ok(CONTRACT_VERSION);
  }
  if (declared.trim() !== CONTRACT_VERSION) {
    return fail(
      gatewayError('contract_mismatch', {
        detail: `this gateway serves contract ${CONTRACT_VERSION}, not ${declared.trim().slice(0, 32)}`,
        requestId,
        retryable: false,
      }),
    );
  }
  return ok(CONTRACT_VERSION);
}

/**
 * Validates the client's required capability list. Unknown names are a request
 * error; a known but unavailable capability is a fail-closed refusal.
 */
export function assertRequiredCapabilities(
  required: readonly string[],
  capabilities: Record<GatewayCapability, boolean>,
  requestId: string,
): GatewayResult<true> {
  const known = new Set<string>(ALL_CAPABILITIES);
  const unknown = required.filter((capability) => !known.has(capability));
  if (unknown.length > 0) {
    return fail(
      gatewayError('validation_failed', {
        detail: `unknown required capability: ${unknown.join(', ').slice(0, 200)}`,
        requestId,
        retryable: false,
      }),
    );
  }
  const unavailable = required.filter(
    (capability) => !capabilities[capability as GatewayCapability],
  );
  if (unavailable.length > 0) {
    return fail(
      gatewayError('capability_unavailable', {
        detail: `the WorkflowEngine does not offer: ${unavailable.join(', ').slice(0, 200)}`,
        requestId,
        retryable: true,
      }),
    );
  }
  return ok(true);
}

export function parseCapabilityHeader(value: string | undefined): string[] {
  if (value == null || value.trim().length === 0) {
    return [];
  }
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
