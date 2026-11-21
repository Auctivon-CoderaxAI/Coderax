import type { WorkflowBuildSettings, WorkflowRunVerification } from 'coderax-data-provider';
import type {
  BuildVerificationConfig,
  BuildVerifierInput,
  WorkflowRunRecord,
  WorkflowStepRecord,
} from '../workflows/types';
import type { BuildGateEvidence, BuildPullRequest, BuildSnapshot } from './report';
import { runBuildVerification } from './verify';
import { getBuildModePolicy } from './modes';
import { summarizeBuild } from './report';

export type { BuildVerificationConfig, BuildVerifierInput } from '../workflows/types';

const MAX_BLOCKERS = 20;
const SUMMARY_MAX_LENGTH = 2_048;
const GATE_SUMMARY_MAX_LENGTH = 512;
const PULL_REQUEST_MAX_LENGTH = 512;

const PULL_REQUEST_URL = /https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+/;

/**
 * A reviewer opens the pull request itself, so the only trustworthy delivery
 * evidence is a URL it reported. The newest step wins.
 */
function findPullRequest(steps: WorkflowStepRecord[]): BuildPullRequest | null {
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
  steps: WorkflowStepRecord[],
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
  run: WorkflowRunRecord,
  steps: WorkflowStepRecord[],
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

  const executed = await runBuildVerification({
    workspaceRoot: config.workspaceRoot,
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
