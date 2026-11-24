import { isTerminalWorkflowRunStatus } from 'coderax-data-provider';
import type { WorkflowRunStatus, WorkflowRunView, WorkflowStepStatus } from 'coderax-data-provider';
import type { BuildGate, BuildMode } from './modes';
import type { BuildRole } from './plan';
import { getBuildModePolicy } from './modes';

export type BuildOutcome =
  | 'in_progress'
  | 'verified_complete'
  | 'complete_unverified'
  | 'partial'
  | 'failed'
  | 'blocked';

export type BuildGateStatus = 'passed' | 'failed' | 'not_run';

/** Evidence for one acceptance gate. A gate is never assumed to have run. */
export interface BuildGateEvidence {
  gate: BuildGate;
  status: BuildGateStatus;
  command?: string;
  summary?: string;
}

export interface BuildStepSnapshot {
  id: string;
  title: string;
  status: WorkflowStepStatus;
  attempts: number;
  role?: BuildRole;
  /** Retained turn output. Its absence is an unverified claim, not a pass. */
  result?: string;
  error?: string;
  reason?: string;
}

export interface BuildPullRequest {
  url: string;
  state: 'open' | 'merged' | 'closed';
  checks?: 'passed' | 'failed' | 'pending' | 'unknown';
}

export interface BuildDeployment {
  status: 'verified' | 'failed' | 'not_attempted';
  url?: string;
}

export interface BuildSnapshot {
  mode: BuildMode;
  status: WorkflowRunStatus;
  steps: BuildStepSnapshot[];
  startedAt?: string;
  settledAt?: string;
  deadlineAt?: string | null;
  gates?: BuildGateEvidence[];
  /** Gates this plan requires beyond its mode's defaults. */
  requiredGates?: readonly BuildGate[];
  pullRequest?: BuildPullRequest | null;
  deployment?: BuildDeployment | null;
}

export interface BuildTaskReport {
  id: string;
  title: string;
  status: WorkflowStepStatus;
  attempts: number;
  role?: BuildRole;
  evidence: boolean;
  reason?: string;
}

export interface BuildDeliveryReport {
  pullRequest: BuildPullRequest | null;
  required: boolean;
  ok: boolean;
  reason?: string;
}

export type TurboReason =
  | 'no_deadline'
  | 'invalid_deadline'
  | 'in_progress'
  | 'verified_within_budget'
  | 'verified_after_budget'
  | 'not_verified'
  | 'missing_timing';

export interface TurboReport {
  targetMs: number | null;
  deadlineAt: string | null;
  met: boolean | null;
  elapsedMs: number | null;
  overrunMs: number | null;
  reason: TurboReason;
}

export interface BuildReport {
  outcome: BuildOutcome;
  verified: boolean;
  finished: BuildTaskReport[];
  unfinished: BuildTaskReport[];
  blocked: BuildTaskReport[];
  unverified: BuildTaskReport[];
  gates: BuildGateEvidence[];
  missingGates: BuildGate[];
  blockers: string[];
  delivery: BuildDeliveryReport;
  deployment: BuildDeployment | null;
  turbo: TurboReport;
  summary: string;
}

export interface BuildReportOptions {
  /** Defaults to the mode's required gates. */
  requiredGates?: readonly BuildGate[];
  /** Defaults to the mode's policy: a reviewable pull request is part of delivery. */
  requirePullRequest?: boolean;
}

function toTaskReport(step: BuildStepSnapshot): BuildTaskReport {
  const evidence = typeof step.result === 'string' && step.result.trim().length > 0;
  return {
    id: step.id,
    title: step.title,
    status: step.status,
    attempts: step.attempts,
    ...(step.role == null ? {} : { role: step.role }),
    evidence,
    ...(step.reason == null ? {} : { reason: step.reason }),
  };
}

function normalizeGates(
  evidence: BuildGateEvidence[] | undefined,
  required: readonly BuildGate[],
): BuildGateEvidence[] {
  const byGate = new Map<BuildGate, BuildGateEvidence>();
  for (const entry of evidence ?? []) {
    if (!byGate.has(entry.gate)) {
      byGate.set(entry.gate, entry);
    }
  }
  for (const gate of required) {
    if (!byGate.has(gate)) {
      byGate.set(gate, { gate, status: 'not_run' });
    }
  }
  return [...byGate.values()];
}

function deliveryReport(
  pullRequest: BuildPullRequest | null | undefined,
  required: boolean,
): BuildDeliveryReport {
  const pr = pullRequest ?? null;
  if (!required) {
    return { pullRequest: pr, required, ok: true };
  }
  if (pr == null) {
    return { pullRequest: null, required, ok: false, reason: 'No reviewable pull request exists' };
  }
  if (pr.state === 'closed') {
    return { pullRequest: pr, required, ok: false, reason: 'The pull request is closed' };
  }
  if (pr.checks === 'failed' || pr.checks === 'pending') {
    return {
      pullRequest: pr,
      required,
      ok: false,
      reason: `Pull request checks are ${pr.checks}`,
    };
  }
  return { pullRequest: pr, required, ok: true };
}

function turboReport(
  snapshot: BuildSnapshot,
  policyDeadlineMs: number | null,
  outcome: BuildOutcome,
): TurboReport {
  const deadlineAt = snapshot.deadlineAt ?? null;
  const targetMs = policyDeadlineMs;
  if (deadlineAt == null) {
    return {
      targetMs,
      deadlineAt: null,
      met: null,
      elapsedMs: null,
      overrunMs: null,
      reason: 'no_deadline',
    };
  }
  const deadlineMs = Date.parse(deadlineAt);
  if (!Number.isFinite(deadlineMs)) {
    return {
      targetMs,
      deadlineAt,
      met: null,
      elapsedMs: null,
      overrunMs: null,
      reason: 'invalid_deadline',
    };
  }
  if (!isTerminalWorkflowRunStatus(snapshot.status)) {
    return {
      targetMs,
      deadlineAt,
      met: null,
      elapsedMs: null,
      overrunMs: null,
      reason: 'in_progress',
    };
  }
  const startMs = snapshot.startedAt == null ? Number.NaN : Date.parse(snapshot.startedAt);
  const endMs = snapshot.settledAt == null ? Number.NaN : Date.parse(snapshot.settledAt);
  const elapsedMs = Number.isFinite(startMs) && Number.isFinite(endMs) ? endMs - startMs : null;
  /** A later snapshot deadline must never relax the mode's own budget. */
  const effectiveDeadlineMs =
    targetMs != null && Number.isFinite(startMs)
      ? Math.min(deadlineMs, startMs + targetMs)
      : deadlineMs;
  const overrunMs = Number.isFinite(endMs) ? Math.max(0, endMs - effectiveDeadlineMs) : null;
  if (outcome !== 'verified_complete') {
    return {
      targetMs,
      deadlineAt,
      met: false,
      elapsedMs,
      overrunMs,
      reason: 'not_verified',
    };
  }
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return { targetMs, deadlineAt, met: false, elapsedMs, overrunMs, reason: 'missing_timing' };
  }
  const withinBudget = endMs <= effectiveDeadlineMs;
  return {
    targetMs,
    deadlineAt,
    met: withinBudget,
    elapsedMs,
    overrunMs,
    reason: withinBudget ? 'verified_within_budget' : 'verified_after_budget',
  };
}

function gateSummary(gates: BuildGateEvidence[]): string {
  return gates.map((gate) => `${gate.gate}: ${gate.status.replace('_', ' ')}`).join(', ');
}

function buildSummary(
  snapshot: BuildSnapshot,
  outcome: BuildOutcome,
  finished: BuildTaskReport[],
  blocked: BuildTaskReport[],
  unfinished: BuildTaskReport[],
  gates: BuildGateEvidence[],
): string {
  const total = snapshot.steps.length;
  return [
    `${finished.length} of ${total} tasks finished; ${blocked.length} failed; ${unfinished.length} unfinished.`,
    `Gates — ${gateSummary(gates)}.`,
    outcome === 'verified_complete'
      ? 'Verified complete.'
      : `Outcome: ${outcome.replace('_', ' ')}.`,
  ].join(' ');
}

/**
 * Turn durable run state and explicit evidence into an honest report. A
 * completed turn is not a completed task, a completed run is not a verified
 * build, and turbo is met only by a verified result inside the budget.
 */
export function summarizeBuild(
  snapshot: BuildSnapshot,
  options: BuildReportOptions = {},
): BuildReport {
  const policy = getBuildModePolicy(snapshot.mode);
  const requiredGates = new Set<BuildGate>(
    options.requiredGates ?? [...policy.requiredGates, ...(snapshot.requiredGates ?? [])],
  );
  if (snapshot.steps.some((step) => step.role === 'security')) {
    requiredGates.add('security');
  }
  const requiredGateList = [...requiredGates];
  const requirePullRequest = options.requirePullRequest ?? policy.requirePullRequest;

  const tasks = snapshot.steps.map(toTaskReport);
  const finished = tasks.filter((task) => task.status === 'completed');
  const blocked = tasks.filter((task) => task.status === 'failed');
  const unfinished = tasks.filter(
    (task) =>
      task.status !== 'completed' && task.status !== 'failed' && task.status !== 'cancelled',
  );
  const cancelled = tasks.filter((task) => task.status === 'cancelled');
  const unverified = finished.filter((task) => !task.evidence);
  const gates = normalizeGates(snapshot.gates, requiredGateList);
  const missingGates = gates
    .filter((gate) => gate.status !== 'passed' && requiredGateList.includes(gate.gate))
    .map((gate) => gate.gate);
  const failedGates = gates.filter((gate) => gate.status === 'failed');
  const delivery = deliveryReport(snapshot.pullRequest, requirePullRequest);
  const terminal = isTerminalWorkflowRunStatus(snapshot.status);

  let outcome: BuildOutcome;
  if (!terminal) {
    outcome = 'in_progress';
  } else if (snapshot.status === 'cancelled') {
    outcome = 'blocked';
  } else if (snapshot.status === 'failed') {
    outcome = finished.length > 0 ? 'partial' : 'failed';
  } else if (blocked.length > 0 || unfinished.length > 0 || cancelled.length > 0) {
    outcome = 'partial';
  } else if (
    missingGates.length === 0 &&
    failedGates.length === 0 &&
    unverified.length === 0 &&
    delivery.ok
  ) {
    outcome = 'verified_complete';
  } else {
    outcome = 'complete_unverified';
  }

  const blockers: string[] = [];
  for (const gate of missingGates) {
    blockers.push(`Required gate ${gate} did not pass`);
  }
  for (const gate of failedGates) {
    if (!missingGates.includes(gate.gate)) {
      blockers.push(`Gate ${gate.gate} failed`);
    }
  }
  for (const task of blocked) {
    blockers.push(`Task ${task.id} failed`);
  }
  for (const task of cancelled) {
    blockers.push(`Task ${task.id} was cancelled`);
  }
  for (const task of unverified) {
    blockers.push(`Task ${task.id} has no retained evidence`);
  }
  if (!delivery.ok && delivery.reason != null) {
    blockers.push(delivery.reason);
  }

  return {
    outcome,
    verified: outcome === 'verified_complete',
    finished,
    unfinished,
    blocked,
    unverified,
    gates,
    missingGates,
    blockers,
    delivery,
    deployment: snapshot.deployment ?? null,
    turbo: turboReport(snapshot, policy.deadlineMs, outcome),
    summary: buildSummary(snapshot, outcome, finished, blocked, unfinished, gates),
  };
}

/**
 * Report on a persisted build run. A completed workflow only means its steps
 * settled; this report verifies the run against the gates captured at launch.
 * Runs without a recorded build policy have no build verification report.
 */
export function summarizeWorkflowBuild(
  run: WorkflowRunView,
  evidence: Pick<BuildSnapshot, 'gates' | 'pullRequest' | 'deployment'> = {},
): BuildReport | null {
  if (run.buildVerification == null) return null;
  return summarizeBuild({
    ...evidence,
    mode: run.buildVerification.mode,
    requiredGates: run.buildVerification.requiredGates,
    status: run.status,
    steps: run.steps,
    startedAt: run.startedAt,
    settledAt: run.settledAt,
  });
}
