import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { WorkflowBuildSettings, WorkflowRunVerification } from 'coderax-data-provider';
import type { BuildGateEvidence, BuildPullRequest, BuildSnapshot } from './report';
import type { BuildVerifierInput } from '../workflows/types';
import type { BuildVerificationConfig } from './config';
import { runBuildVerification } from './verify';
import { getBuildModePolicy } from './modes';
import { summarizeBuild } from './report';

/* Re-exported so this module keeps its public surface after the cycle break. */
export type { BuildVerificationConfig, BuildVerifierInput };

const MAX_BLOCKERS = 20;
const SUMMARY_MAX_LENGTH = 2_048;
const GATE_SUMMARY_MAX_LENGTH = 512;
const PULL_REQUEST_MAX_LENGTH = 512;

const PULL_REQUEST_URL = /https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+/;

/**
 * Resolves the run's own checkout under the deployment root. The workspace is
 * already a single safe directory name, but the symlink-aware containment
 * check keeps a checkout from pointing verification at another build's tree.
 */
function resolveBuildWorkspace(
  baseRoot: string,
  workspace: string,
): { ok: true; value: string } | { ok: false; message: string } {
  if (!isAbsolute(baseRoot)) {
    return { ok: false, message: 'The deployment build root must be an absolute path.' };
  }
  let base: string;
  try {
    base = realpathSync(resolve(baseRoot));
  } catch {
    return { ok: false, message: 'The deployment build root is not an existing directory.' };
  }
  let candidate: string;
  try {
    candidate = realpathSync(resolve(base, workspace));
  } catch {
    return { ok: false, message: `The build workspace ${workspace} has no checkout.` };
  }
  const rel = relative(base, candidate);
  if (rel.length === 0 || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return {
      ok: false,
      message: `The build workspace ${workspace} is outside the deployment build root.`,
    };
  }
  if (rel !== workspace) {
    return { ok: false, message: `The build workspace ${workspace} aliases another checkout.` };
  }
  return { ok: true, value: candidate };
}

/**
 * A reviewer opens the pull request itself, so the only trustworthy delivery
 * evidence is a URL it reported. The newest step wins.
 */
function findPullRequest(steps: BuildVerifierInput['steps']): BuildPullRequest | null {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const result = steps[index].result;
    if (typeof result !== 'string') {
      continue;
    }
    const match = PULL_REQUEST_URL.exec(result);
    if (match != null) {
      return { url: match[0], state: 'open' };
    }
  }
  return null;
}

function toGate(entry: BuildGateEvidence): WorkflowRunVerification['gates'][number] {
  return {
    gate: entry.gate,
    status: entry.status,
    ...(entry.summary == null ? {} : { summary: entry.summary.slice(0, GATE_SUMMARY_MAX_LENGTH) }),
  };
}

function failedVerdict(input: {
  mode: WorkflowBuildSettings['mode'];
  checkedAt: string;
  summary: string;
}): WorkflowRunVerification {
  return {
    status: 'failed',
    mode: input.mode,
    outcome: 'complete_unverified',
    checkedAt: input.checkedAt,
    summary: input.summary.slice(0, SUMMARY_MAX_LENGTH),
    gates: [],
    blockers: [input.summary.slice(0, GATE_SUMMARY_MAX_LENGTH)],
  };
}

/**
 * Review is a judgement, not a shell command. Its evidence is the named review
 * step's retained output, and a missing or empty review step is a failure to
 * produce evidence rather than a pass by default.
 */
function reviewEvidence(
  build: WorkflowBuildSettings,
  steps: BuildVerifierInput['steps'],
): BuildGateEvidence {
  if (build.reviewStepId == null) {
    return {
      gate: 'review',
      status: 'not_run',
      summary: 'The plan has no independent review step',
    };
  }
  const step = steps.find((entry) => entry.id === build.reviewStepId);
  if (step == null) {
    return {
      gate: 'review',
      status: 'not_run',
      summary: 'The review step is not part of this run',
    };
  }
  const retained = typeof step.result === 'string' && step.result.trim().length > 0;
  if (step.status !== 'completed' || !retained) {
    return {
      gate: 'review',
      status: 'failed',
      summary: `Review step ${step.id.slice(0, 128)} did not complete with retained output`,
    };
  }
  return {
    gate: 'review',
    status: 'passed',
    summary: `Review step ${step.id.slice(0, 128)} completed with retained output`,
  };
}

function snapshotFor(
  run: BuildVerifierInput['run'],
  steps: BuildVerifierInput['steps'],
  build: WorkflowBuildSettings,
  gates: BuildGateEvidence[],
  pullRequest: BuildPullRequest | null,
): BuildSnapshot {
  return {
    mode: build.mode,
    // Verification only runs at settlement, so the run is about to complete.
    status: 'completed',
    steps: steps.map((step) => ({
      id: step.id,
      title: step.title,
      status: step.status,
      attempts: step.attempts,
      ...(step.id === build.reviewStepId ? { role: 'reviewer' as const } : {}),
      ...(step.result == null ? {} : { result: step.result }),
      ...(step.error == null ? {} : { error: step.error }),
      ...(step.reason == null ? {} : { reason: step.reason }),
    })),
    ...(run.startedAt == null ? {} : { startedAt: run.startedAt.toISOString() }),
    deadlineAt: build.deadlineAt ?? null,
    gates,
    requiredGates: build.requiredGates,
    pullRequest,
  };
}

/**
 * Execute the deployment's verification commands, then judge the whole run with
 * the build report. A command that could not run, a gate that did not pass, a
 * step with no retained evidence, or a missing pull request all produce a
 * `failed` verdict, which settlement treats as a failed run.
 */
export async function verifyBuildRun(
  input: BuildVerifierInput,
  config: BuildVerificationConfig,
): Promise<WorkflowRunVerification> {
  const { run, steps } = input;
  const checkedAt = new Date().toISOString();
  const build = run.settings?.build;
  if (build == null) {
    return failedVerdict({
      mode: 'autonomous',
      checkedAt,
      summary: 'This run has no build plan, so it cannot produce build evidence.',
    });
  }
  if (build.repository == null) {
    return failedVerdict({
      mode: build.mode,
      checkedAt,
      summary: 'This run has no repository binding, so its delivery cannot be attributed.',
    });
  }
  if (build.workspace == null) {
    return failedVerdict({
      mode: build.mode,
      checkedAt,
      summary: 'This run has no workspace binding, so verification has no checkout to run in.',
    });
  }
  const workspace = resolveBuildWorkspace(config.workspaceRoot, build.workspace);
  if (!workspace.ok) {
    return failedVerdict({ mode: build.mode, checkedAt, summary: workspace.message });
  }

  const executed = await runBuildVerification({
    workspaceRoot: workspace.value,
    commands: config.commands,
    ...(config.runner == null ? {} : { runner: config.runner }),
    ...(config.allowedCommands == null ? {} : { allowedCommands: config.allowedCommands }),
    ...(config.defaultTimeoutMs == null ? {} : { defaultTimeoutMs: config.defaultTimeoutMs }),
    ...(input.signal == null ? {} : { signal: input.signal }),
  });
  if (!executed.ok) {
    return failedVerdict({
      mode: build.mode,
      checkedAt,
      summary: executed.error.message,
    });
  }

  const requirePullRequest =
    config.requirePullRequest ??
    build.requirePullRequest ??
    getBuildModePolicy(build.mode).requirePullRequest;
  const pullRequest = findPullRequest(steps);
  const gates: BuildGateEvidence[] = [...executed.value.gates, reviewEvidence(build, steps)];
  const report = summarizeBuild(snapshotFor(run, steps, build, gates, pullRequest), {
    requiredGates: build.requiredGates,
    requirePullRequest,
  });

  return {
    status: report.verified ? 'verified' : 'failed',
    mode: build.mode,
    outcome: report.outcome,
    checkedAt,
    summary: report.summary.slice(0, SUMMARY_MAX_LENGTH),
    gates: report.gates.map(toGate),
    blockers: report.blockers
      .slice(0, MAX_BLOCKERS)
      .map((blocker) => blocker.slice(0, GATE_SUMMARY_MAX_LENGTH)),
    ...(pullRequest == null
      ? {}
      : { pullRequestUrl: pullRequest.url.slice(0, PULL_REQUEST_MAX_LENGTH) }),
  };
}

/** Binds deployment policy to the workflow engine's `verifyRun` port. */
export function createBuildVerifier(config: BuildVerificationConfig) {
  return (input: BuildVerifierInput): Promise<WorkflowRunVerification> =>
    verifyBuildRun(input, config);
}
