import { z } from 'zod';
import type { ProblemCode } from './contracts';

/**
 * Stable failure codes the gateway adds on top of the engine's `ProblemCode`.
 * A client branches on `code`; `detail` is user-safe text and never carries a
 * stack, an upstream payload, a request body, a header or a credential.
 */
export type GatewayOnlyFailureCode =
  | 'gateway_disabled'
  | 'capability_unavailable'
  | 'contract_mismatch'
  | 'transport_native'
  | 'authority_conflict'
  | 'upstream_unavailable';

export const GATEWAY_FAILURE_CODES: readonly GatewayOnlyFailureCode[] = [
  'gateway_disabled',
  'capability_unavailable',
  'contract_mismatch',
  'transport_native',
  'authority_conflict',
  'upstream_unavailable',
];

export type GatewayFailureCode = ProblemCode | GatewayOnlyFailureCode;

export type GatewayProblemCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation_failed'
  | 'conflict'
  | 'busy'
  | 'not_ready'
  | 'engine_unavailable'
  | 'engine_not_configured'
  | 'model_missing'
  | 'workspace_denied'
  | 'budget_exhausted'
  | 'paid_model_refused'
  | 'permission_required'
  | 'cancelled'
  | 'protocol_error'
  | 'internal_error'
  | 'gateway_disabled'
  | 'capability_unavailable'
  | 'contract_mismatch'
  | 'transport_native'
  | 'authority_conflict'
  | 'upstream_unavailable';

const GatewayProblemCodeSchema: z.ZodType<GatewayProblemCode> = z.enum([
  'unauthorized',
  'forbidden',
  'not_found',
  'validation_failed',
  'conflict',
  'busy',
  'not_ready',
  'engine_unavailable',
  'engine_not_configured',
  'model_missing',
  'workspace_denied',
  'budget_exhausted',
  'paid_model_refused',
  'permission_required',
  'cancelled',
  'protocol_error',
  'internal_error',
  'gateway_disabled',
  'capability_unavailable',
  'contract_mismatch',
  'transport_native',
  'authority_conflict',
  'upstream_unavailable',
]);

/** The wire shape every gateway failure uses; the engine's `Problem` plus gateway codes. */
export type GatewayProblem = {
  type: string;
  title: string;
  status: number;
  code: GatewayProblemCode;
  detail?: string;
  requestId?: string;
  retryable: boolean;
};

export const GatewayProblem: z.ZodType<GatewayProblem> = z
  .object({
    type: z.string().min(1).max(200),
    title: z.string().min(1).max(200),
    status: z.number().int().min(400).max(599),
    code: GatewayProblemCodeSchema,
    detail: z.string().max(2000).optional(),
    requestId: z.string().min(1).max(128).optional(),
    retryable: z.boolean(),
  })
  .strict();

export type GatewayError = {
  code: GatewayFailureCode;
  status: number;
  title: string;
  detail?: string;
  retryable: boolean;
  requestId?: string;
};

export type GatewayResult<T> = { ok: true; value: T } | { ok: false; error: GatewayError };

export function ok<T>(value: T): GatewayResult<T> {
  return { ok: true, value };
}

export function fail<T = never>(error: GatewayError): GatewayResult<T> {
  return { ok: false, error };
}

const TITLES: Readonly<Record<GatewayFailureCode, string>> = Object.freeze({
  unauthorized: 'unauthorized',
  forbidden: 'forbidden',
  not_found: 'not found',
  validation_failed: 'validation failed',
  conflict: 'conflict',
  busy: 'busy',
  not_ready: 'not ready',
  engine_unavailable: 'engine unavailable',
  engine_not_configured: 'engine not configured',
  model_missing: 'model missing',
  workspace_denied: 'workspace denied',
  budget_exhausted: 'budget exhausted',
  paid_model_refused: 'paid model refused',
  permission_required: 'permission required',
  cancelled: 'cancelled',
  protocol_error: 'protocol error',
  internal_error: 'internal error',
  gateway_disabled: 'gateway disabled',
  capability_unavailable: 'capability unavailable',
  contract_mismatch: 'contract mismatch',
  transport_native: 'transport owned by native engine',
  authority_conflict: 'authority conflict',
  upstream_unavailable: 'workflow engine unavailable',
});

const STATUS: Readonly<Record<GatewayFailureCode, number>> = Object.freeze({
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation_failed: 400,
  conflict: 409,
  busy: 409,
  not_ready: 503,
  engine_unavailable: 503,
  engine_not_configured: 503,
  model_missing: 503,
  workspace_denied: 403,
  budget_exhausted: 429,
  paid_model_refused: 402,
  permission_required: 409,
  cancelled: 409,
  protocol_error: 502,
  internal_error: 500,
  gateway_disabled: 503,
  capability_unavailable: 503,
  contract_mismatch: 502,
  transport_native: 409,
  authority_conflict: 409,
  upstream_unavailable: 503,
});

const RETRYABLE: ReadonlySet<GatewayFailureCode> = new Set<GatewayFailureCode>([
  'not_ready',
  'engine_unavailable',
  'busy',
  'upstream_unavailable',
  'capability_unavailable',
  'internal_error',
]);

export function gatewayError(
  code: GatewayFailureCode,
  options: { detail?: string; requestId?: string; retryable?: boolean } = {},
): GatewayError {
  return {
    code,
    status: STATUS[code],
    title: TITLES[code],
    retryable: options.retryable ?? RETRYABLE.has(code),
    ...(options.detail ? { detail: options.detail.slice(0, 500) } : {}),
    ...(options.requestId ? { requestId: options.requestId } : {}),
  };
}

export function toProblem(error: GatewayError): GatewayProblem {
  return {
    type: `https://coderax.dev/problems/${error.code}`,
    title: error.title,
    status: error.status,
    code: error.code as GatewayProblemCode,
    retryable: error.retryable,
    ...(error.detail ? { detail: error.detail } : {}),
    ...(error.requestId ? { requestId: error.requestId } : {}),
  };
}

/**
 * Maps an engine `Problem` onto the gateway's error. The engine's `title` and
 * `detail` are intentionally not forwarded: only the stable code, the HTTP
 * status and the retryable flag cross the boundary. This keeps an upstream
 * deployment from writing arbitrary text into a Coderax UI surface.
 */
export function fromEngineProblem(problem: {
  code: ProblemCode;
  status: number;
  retryable: boolean;
  requestId?: string;
}): GatewayError {
  const known = problem.code in STATUS;
  const code = (known ? problem.code : 'upstream_unavailable') as GatewayFailureCode;
  return {
    code,
    status: problem.status,
    title: TITLES[code],
    retryable: problem.retryable,
    ...(problem.requestId ? { requestId: problem.requestId } : {}),
  };
}
