import type { BuildPlan } from './plan';
import { assessBuildPlan } from './plan';

/**
 * Three execution policies over the same durable workflow engine. A mode
 * changes time budget, parallelism and required evidence; it never disables
 * verification or authorizes a deployment.
 */
export const BUILD_MODES = ['turbo15', 'autonomous', 'verified'] as const;

export type BuildMode = (typeof BUILD_MODES)[number];

export const BUILD_GATES = ['tests', 'build', 'review', 'security'] as const;

export type BuildGate = (typeof BUILD_GATES)[number];

/** The turbo target: a verified MVP, not merely a finished-looking run. */
export const TURBO_15_BUDGET_MS: number = 15 * 60_000;

/** A dependency chain longer than this cannot target a 15-minute MVP honestly. */
export const TURBO_MAX_CRITICAL_PATH = 6;

export interface BuildModePolicy {
  mode: BuildMode;
  /** Wall-clock target for the whole build; null means no deadline. */
  deadlineMs: number | null;
  maxTasks: number;
  maxParallel: number;
  maxAttempts: number;
  requiredGates: readonly BuildGate[];
  /**
   * Turbo reports the missed target and keeps working. It never stops honest
   * work at the deadline, and it never reports an unfinished build as done.
   */
  continueAfterDeadline: boolean;
  /** No mode authorizes a deployment on its own. */
  allowDeploy: boolean;
  requirePullRequest: boolean;
}

const POLICIES: Record<BuildMode, BuildModePolicy> = {
  turbo15: {
    mode: 'turbo15',
    deadlineMs: TURBO_15_BUDGET_MS,
    maxTasks: 8,
    maxParallel: 4,
    maxAttempts: 2,
    requiredGates: ['tests', 'build', 'review'],
    continueAfterDeadline: true,
    allowDeploy: false,
    requirePullRequest: true,
  },
  autonomous: {
    mode: 'autonomous',
    deadlineMs: null,
    maxTasks: 20,
    maxParallel: 4,
    maxAttempts: 3,
    requiredGates: ['tests', 'build', 'review'],
    continueAfterDeadline: false,
    allowDeploy: false,
    requirePullRequest: true,
  },
  verified: {
    mode: 'verified',
    deadlineMs: null,
    maxTasks: 25,
    maxParallel: 2,
    maxAttempts: 3,
    requiredGates: ['tests', 'build', 'review', 'security'],
    continueAfterDeadline: false,
    allowDeploy: false,
    requirePullRequest: true,
  },
};

export function getBuildModePolicy(mode: BuildMode): BuildModePolicy {
  return POLICIES[mode];
}

/**
 * A plan that asks for security work or claims it in an acceptance criterion
 * earns the security gate even in a mode whose base gates omit it. A plan can
 * add evidence requirements; it can never remove one.
 */
export function requiredGatesForPlan(mode: BuildMode, plan: BuildPlan): BuildGate[] {
  const gates = new Set<BuildGate>(getBuildModePolicy(mode).requiredGates);
  if (assessBuildPlan(plan).requiresSecurityReview) {
    gates.add('security');
  }
  return [...gates];
}

export type BuildComplexity = 'simple' | 'moderate' | 'complex';

export interface ComplexityAssessment {
  complexity: BuildComplexity;
  surfaces: string[];
  score: number;
  /** A heuristic starting point; it never overrides a real plan assessment. */
  turboFeasible: boolean;
  reasons: string[];
}

const SURFACE_SIGNALS: ReadonlyArray<{ surface: string; pattern: RegExp }> = [
  {
    surface: 'frontend',
    pattern: /\b(frontend|front-end|ui|react|next\.?js|component|page|css|tailwind)\b/i,
  },
  {
    surface: 'backend',
    pattern: /\b(backend|back-end|api|endpoint|express|server|route|handler)\b/i,
  },
  {
    surface: 'database',
    pattern: /\b(database|db|schema|migration|postgres|mongo|sql|persistence)\b/i,
  },
  {
    surface: 'authentication',
    pattern: /\b(auth|authentication|authorization|login|oauth|session|rbac|permission)\b/i,
  },
  {
    surface: 'testing',
    pattern: /\b(test|tests|testing|jest|playwright|e2e|unit)\b/i,
  },
  {
    surface: 'deployment',
    pattern: /\b(deploy|deployment|docker|ci\/cd|kubernetes|helm|vercel)\b/i,
  },
  {
    surface: 'realtime',
    pattern: /\b(realtime|real-time|websocket|sse|streaming|queue|worker)\b/i,
  },
  {
    surface: 'payments',
    pattern: /\b(payment|payments|billing|stripe|checkout|subscription)\b/i,
  },
];

const COMPLETENESS_SIGNAL =
  /\b(complete|full[- ]stack|end[- ]to[- ]end|production|from scratch)\b/i;

/**
 * A request-level estimate used before a plan exists. It is deliberately
 * conservative: the plan assessment below decides whether turbo can start.
 */
export function assessRequestComplexity(request: string): ComplexityAssessment {
  const text = String(request ?? '');
  const surfaces = SURFACE_SIGNALS.filter((signal) => signal.pattern.test(text)).map(
    (signal) => signal.surface,
  );
  const reasons: string[] = [];
  if (surfaces.length > 0) {
    reasons.push(`Detected surfaces: ${surfaces.join(', ')}`);
  }
  let score = surfaces.length;
  if (COMPLETENESS_SIGNAL.test(text)) {
    score += 1;
    reasons.push('The request asks for a complete or production-level result.');
  }
  let complexity: BuildComplexity = 'simple';
  if (score >= 5) {
    complexity = 'complex';
  } else if (score >= 3) {
    complexity = 'moderate';
  }
  return {
    complexity,
    surfaces,
    score,
    turboFeasible: complexity !== 'complex',
    reasons,
  };
}

export interface BuildModeDecision {
  mode: BuildMode;
  requested: BuildMode;
  degraded: boolean;
  reason?: string;
}

/**
 * Turbo is a target, not a promise. An oversized or complex plan is executed
 * autonomously instead, and the reason is recorded rather than hidden behind a
 * 15-minute claim the plan cannot meet.
 */
export function chooseEffectiveMode(input: {
  requested: BuildMode;
  plan?: BuildPlan | null;
  request?: string;
}): BuildModeDecision {
  const { requested, plan, request } = input;
  if (requested !== 'turbo15') {
    return { mode: requested, requested, degraded: false };
  }

  const policy = getBuildModePolicy('turbo15');
  const reasons: string[] = [];
  const planAssessment = plan == null ? null : assessBuildPlan(plan);
  const explicitRequest = request?.trim();
  const planRequest = plan?.request?.trim();
  const assessedRequest =
    [explicitRequest, planRequest].find((value) => value != null && value.length > 0) ?? null;
  const requestAssessment =
    assessedRequest == null ? null : assessRequestComplexity(assessedRequest);

  if (planAssessment != null && planAssessment.taskCount > policy.maxTasks) {
    reasons.push(
      `The plan has ${planAssessment.taskCount} tasks; turbo admits at most ${policy.maxTasks}.`,
    );
  }
  if (planAssessment != null && planAssessment.criticalPathLength > TURBO_MAX_CRITICAL_PATH) {
    reasons.push(
      `The dependency chain needs ${planAssessment.criticalPathLength} sequential steps; turbo allows ${TURBO_MAX_CRITICAL_PATH}.`,
    );
  }
  if (requestAssessment?.complexity === 'complex') {
    reasons.push(
      'The request spans enough surfaces that a verified 15-minute MVP is not realistic.',
    );
  }

  if (reasons.length === 0) {
    return { mode: 'turbo15', requested, degraded: false };
  }
  return {
    mode: 'autonomous',
    requested,
    degraded: true,
    reason: reasons.join(' '),
  };
}

/** An absolute deadline for a mode, or null when the mode has no time budget. */
export function buildDeadline(mode: BuildMode, startedAt: Date): Date | null {
  const { deadlineMs } = getBuildModePolicy(mode);
  return deadlineMs == null ? null : new Date(startedAt.getTime() + deadlineMs);
}
