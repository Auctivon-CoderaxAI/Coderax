import { assertAuthorized, assertTargetInScope, ScopeError } from './scope.js';

export class PolicyError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'PolicyError';
    this.code = code;
    Object.assign(this, extra);
  }
}

export const DEPTHS = ['passive', 'active_readonly', 'intrusive'];
const RANK = { passive: 0, active_readonly: 1, intrusive: 2, local: 0 };

const PROHIBITED = new Set([
  'lateral_movement',
  'persistence',
  'credential_theft',
  'phishing',
  'destructive',
  'denial_of_service',
  'payload_delivery',
  'evasion_of_detection',
]);

export function assertDepth(depth) {
  if (!DEPTHS.includes(depth)) {
    throw new PolicyError('invalid_depth', `Unknown testing depth: ${depth}`);
  }
  return depth;
}

export function createApproval({ toolId, target, requestedBy, now = Date.now(), ttlMs = 10 * 60 * 1000 }) {
  if (!toolId || !target) throw new PolicyError('invalid_approval', 'Approval needs a tool and a target');
  return {
    id: `ap_${now.toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
    toolId,
    target,
    requestedBy: requestedBy ?? null,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
    consumed: false,
  };
}

export function findValidApproval(approvals, toolId, target, now = Date.now()) {
  return (approvals ?? []).find((a) => (
    a && a.toolId === toolId && a.target === target && !a.consumed && Date.parse(a.expiresAt) > now
  )) ?? null;
}

export async function authorizeToolRun({
  engagement,
  tool,
  target,
  approvals = [],
  now = Date.now(),
  resolve,
} = {}) {
  if (!tool || typeof tool !== 'object' || !tool.id) {
    throw new PolicyError('invalid_tool', 'A tool definition is required');
  }
  if (PROHIBITED.has(tool.capability) || tool.prohibited === true) {
    return { allowed: false, code: 'prohibited_capability', reason: `${tool.id} is not an approved capability` };
  }
  if (!tool.capability || !(tool.capability in RANK)) {
    return { allowed: false, code: 'invalid_capability', reason: `${tool.id} declares no valid capability` };
  }

  try {
    assertAuthorized(engagement);
  } catch (err) {
    if (err instanceof ScopeError) return { allowed: false, code: err.code, reason: err.message };
    throw err;
  }

  const depth = assertDepth(engagement.depth);

  if (tool.exploitValidation && engagement.kind !== 'lab') {
    return { allowed: false, code: 'lab_only', reason: 'Exploit validation is limited to isolated lab engagements' };
  }

  if (tool.scope === 'workspace') {
    if (target && (target.startsWith('/') || target.includes('..'))) {
      return { allowed: false, code: 'invalid_workspace_path', reason: 'Workspace targets must be relative paths' };
    }
    return { allowed: true, code: 'allowed', toolId: tool.id, target: target ?? null };
  }

  if (!target) {
    return { allowed: false, code: 'target_required', reason: `${tool.id} needs a target` };
  }

  let resolved;
  try {
    resolved = await assertTargetInScope(target, engagement, { resolve });
  } catch (err) {
    if (err instanceof ScopeError) return { allowed: false, code: err.code, reason: err.message };
    throw err;
  }

  if (RANK[tool.capability] > RANK[depth]) {
    return {
      allowed: false,
      code: 'insufficient_depth',
      reason: `${tool.capability} activity is not permitted at depth ${depth}`,
    };
  }

  if (tool.capability === 'intrusive') {
    const approval = findValidApproval(approvals, tool.id, target, now);
    if (!approval) {
      return {
        allowed: false,
        code: 'approval_required',
        reason: `${tool.id} needs a fresh per-action approval for ${target}`,
        requiresApproval: true,
        toolId: tool.id,
        target,
      };
    }
    return { allowed: true, code: 'allowed', toolId: tool.id, target, approvalId: approval.id, addresses: resolved.addresses };
  }

  return { allowed: true, code: 'allowed', toolId: tool.id, target, addresses: resolved.addresses };
}

export function toolAvailability(tool, env = {}) {
  if (!tool) return { available: false, reason: 'unknown tool' };
  if (PROHIBITED.has(tool.capability) || tool.prohibited) return { available: false, reason: 'prohibited capability' };
  if (tool.builtin) return { available: true, reason: null };
  const key = `SECURITY_TOOL_${String(tool.id).toUpperCase().replace(/[^A-Z0-9]/g, '_')}_BIN`;
  if (env[key]) return { available: true, reason: null, binary: env[key] };
  return { available: false, reason: 'no isolated runner configured' };
}
