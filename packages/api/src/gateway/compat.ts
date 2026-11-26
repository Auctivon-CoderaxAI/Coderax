import type { HealthReport } from './contracts';
import type { EngineClient } from './client';
import { GatewayTransportError } from './client';

/**
 * The one handshake Coderax performs before it proxies a single request.
 *
 * A version mismatch, an unhealthy engine or a protocol shape Coderax does not
 * understand refuses traffic instead of attempting a best-effort call: a
 * partially compatible engine is exactly how a conversation ends up with two
 * authoritative writers. Capability limits are reported separately so a route
 * can fail closed per capability rather than pretending the engine supports it.
 */

export type GatewayCapabilities = {
  streaming: boolean;
  cancellation: boolean;
  resume: boolean;
  durable: boolean;
};

export type CompatibilityReport = {
  compatible: true;
  contractVersion: string;
  engineStatus: HealthReport['status'];
  capabilities: GatewayCapabilities;
  checkedAt: string;
  workAvailable: boolean;
};

export type CompatibilityFailureCode =
  | 'contract_version_mismatch'
  | 'engine_unhealthy'
  | 'engine_not_ready'
  | 'engine_unreachable'
  | 'protocol_error';

export class GatewayCompatibilityError extends Error {
  readonly code: CompatibilityFailureCode;

  constructor(code: CompatibilityFailureCode, message: string) {
    super(message);
    this.name = 'GatewayCompatibilityError';
    this.code = code;
  }
}

export function capabilitiesOf(health: HealthReport): GatewayCapabilities {
  const engines = health.engines.filter((engine) => engine.availability.available);
  return {
    streaming: engines.some((engine) => engine.capabilities.streaming),
    cancellation: engines.some((engine) => engine.capabilities.cancellation),
    resume: engines.some((engine) => engine.capabilities.resume),
    durable: engines.some((engine) => engine.capabilities.durable),
  };
}

export async function checkCompatibility(
  client: Pick<EngineClient, 'health' | 'expectedContractVersion'>,
  signal?: AbortSignal,
): Promise<CompatibilityReport> {
  let health: HealthReport;
  try {
    health = await client.health(signal);
  } catch (cause) {
    if (cause instanceof GatewayTransportError) {
      if (cause.code === 'engine_unreachable' || cause.code === 'engine_timeout') {
        throw new GatewayCompatibilityError('engine_unreachable', cause.message);
      }
    }
    throw new GatewayCompatibilityError(
      'protocol_error',
      'The engine health report could not be verified.',
    );
  }

  if (health.contractVersion !== client.expectedContractVersion) {
    throw new GatewayCompatibilityError(
      'contract_version_mismatch',
      `The engine serves contract ${health.contractVersion}; this gateway requires ${client.expectedContractVersion}.`,
    );
  }
  if (health.status === 'failed') {
    throw new GatewayCompatibilityError(
      'engine_unhealthy',
      'The engine reports a failed health check.',
    );
  }
  const failedRequired = health.checks.find((check) => check.required && check.status === 'failed');
  if (failedRequired != null) {
    throw new GatewayCompatibilityError(
      'engine_unhealthy',
      `The engine reports a failed required check: ${failedRequired.name}.`,
    );
  }

  return {
    compatible: true,
    contractVersion: health.contractVersion,
    engineStatus: health.status,
    capabilities: capabilitiesOf(health),
    workAvailable: health.engines.some(
      (engine) =>
        engine.availability.available &&
        WORK_CAPABILITIES.every((capability) => engine.capabilities[capability]),
    ),
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Startup readiness is stricter than health: the engine must have finished its
 * own validation, otherwise a queued task would be accepted by a process that
 * cannot execute it.
 */
export async function checkStartupReady(
  client: Pick<EngineClient, 'health' | 'readiness' | 'expectedContractVersion'>,
  signal?: AbortSignal,
): Promise<CompatibilityReport> {
  const report = await checkCompatibility(client, signal);
  let readiness;
  try {
    readiness = await client.readiness(signal);
  } catch (cause) {
    if (cause instanceof GatewayTransportError) {
      throw new GatewayCompatibilityError('engine_unreachable', cause.message);
    }
    throw new GatewayCompatibilityError(
      'protocol_error',
      'The engine readiness report could not be verified.',
    );
  }
  if (!readiness.ready) {
    throw new GatewayCompatibilityError(
      'engine_not_ready',
      readiness.missing.length > 0
        ? `The engine is not ready: ${readiness.missing.join(', ')}.`
        : 'The engine is not ready.',
    );
  }
  return report;
}

export const WORK_CAPABILITIES: readonly (keyof GatewayCapabilities)[] = [
  'durable',
  'cancellation',
  'resume',
];

export function missingCapabilities(
  report: CompatibilityReport,
  required: readonly (keyof GatewayCapabilities)[],
): (keyof GatewayCapabilities)[] {
  return required.filter((capability) => !report.capabilities[capability]);
}
