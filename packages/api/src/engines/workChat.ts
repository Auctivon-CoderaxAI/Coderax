/**
 * Owner-gated OpenCode execution inside the Work chat ingress.
 *
 * This is deliberately not a general engine picker: the deployment enables it
 * with `engines.workChat.enabled`, and only an ADMIN may reach it. Everyone
 * else, and every request with a selected agent or attachments, continues to
 * the native runner. The branch reuses the existing Work conversation, message
 * rows and cancel route; it never creates a second task lifecycle.
 */

export type {
  EngineWorkChatConfig,
  EngineWorkChatRunner,
  EngineWorkChatStore,
} from './workChat/types';
export { EngineWorkChatRuntime, getEngineWorkChatRuntime } from './workChat/runtime';
export {
  createMemoryWorkRunLeaseStore,
  createWorkRunLeaseStore,
  DEFAULT_WORK_RUN_LEASE_TTL_MS,
  DEFAULT_WORK_RUN_RETENTION_MS,
  memoryWorkRunLeases,
  WORK_RUN_SWEEP_LIMIT,
  workRunKey,
} from './workChat/leases';
export type {
  WorkRunCancelOutcome,
  WorkRunDb,
  WorkRunLeaseClaim,
  WorkRunLeaseSnapshot,
  WorkRunLeaseStore,
} from './workChat/leases';
export { createEngineWorkChatPersistence } from './workChat/persistence';
export { createEngineWorkChatHandler } from './workChat/handler';
