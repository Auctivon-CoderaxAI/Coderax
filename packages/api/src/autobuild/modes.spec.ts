import type { BuildPlan } from './plan';
import { parseBuildPlan } from './plan';
import {
  assessRequestComplexity,
  buildDeadline,
  chooseEffectiveMode,
  getBuildModePolicy,
  TURBO_15_BUDGET_MS,
} from './modes';

const task = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  title: `Task ${id}`,
  role: 'backend',
  instruction: 'Implement the task.',
  acceptance: ['The change is verified'],
  dependsOn: [],
  ...overrides,
});

function planWith(count: number): BuildPlan {
  const result = parseBuildPlan({
    name: 'Plan',
    request: 'Build many things',
    tasks: Array.from({ length: count }, (_, index) => task(`task-${index}`)),
  });
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}

describe('build mode policy', () => {
  it('gives turbo a fifteen-minute target and no deployment authority', () => {
    const policy = getBuildModePolicy('turbo15');

    expect(policy.deadlineMs).toBe(TURBO_15_BUDGET_MS);
    expect(policy.requiredGates).toEqual(['tests', 'build', 'review']);
    expect(policy.allowDeploy).toBe(false);
    expect(policy.continueAfterDeadline).toBe(true);
  });

  it('adds a security gate and lower parallelism to verified mode', () => {
    const policy = getBuildModePolicy('verified');

    expect(policy.deadlineMs).toBeNull();
    expect(policy.requiredGates).toContain('security');
    expect(policy.maxParallel).toBe(2);
  });

  it('never authorizes deployment from any mode', () => {
    expect(getBuildModePolicy('autonomous').allowDeploy).toBe(false);
    expect(getBuildModePolicy('verified').allowDeploy).toBe(false);
  });
});

describe('assessRequestComplexity', () => {
  it('classifies a small change as simple', () => {
    const assessment = assessRequestComplexity('Add a settings page with a save button.');

    expect(assessment.complexity).toBe('simple');
    expect(assessment.surfaces).toEqual(['frontend']);
    expect(assessment.turboFeasible).toBe(true);
  });

  it('classifies a multi-surface request as moderate', () => {
    const assessment = assessRequestComplexity(
      'Add a backend API, a database schema, and tests for both.',
    );

    expect(assessment.complexity).toBe('moderate');
    expect(assessment.surfaces).toEqual(['backend', 'database', 'testing']);
  });

  it('classifies a complete full-stack request as complex and not turbo-feasible', () => {
    const assessment = assessRequestComplexity(
      'Build a complete full-stack application with frontend, backend, database, authentication, tests, and deployment.',
    );

    expect(assessment.complexity).toBe('complex');
    expect(assessment.turboFeasible).toBe(false);
    expect(assessment.reasons.length).toBeGreaterThan(0);
  });
});

describe('chooseEffectiveMode', () => {
  it('keeps a small plan in turbo', () => {
    const decision = chooseEffectiveMode({ requested: 'turbo15', plan: planWith(4) });

    expect(decision.mode).toBe('turbo15');
    expect(decision.degraded).toBe(false);
  });

  it('continues an oversized turbo plan autonomously and records why', () => {
    const decision = chooseEffectiveMode({ requested: 'turbo15', plan: planWith(9) });

    expect(decision.mode).toBe('autonomous');
    expect(decision.degraded).toBe(true);
    expect(decision.reason).toMatch(/at most 8/);
  });

  it('degrades a complex request even without a plan', () => {
    const decision = chooseEffectiveMode({
      requested: 'turbo15',
      request:
        'Build a complete full-stack application with frontend, backend, database, authentication, payments, tests, and deployment.',
    });

    expect(decision.mode).toBe('autonomous');
    expect(decision.degraded).toBe(true);
  });

  it('does not change a non-turbo mode', () => {
    const decision = chooseEffectiveMode({ requested: 'verified', plan: planWith(9) });

    expect(decision.mode).toBe('verified');
    expect(decision.degraded).toBe(false);
  });
});

describe('buildDeadline', () => {
  it('returns an absolute fifteen-minute deadline for turbo', () => {
    const startedAt = new Date('2026-01-01T00:00:00.000Z');
    const deadline = buildDeadline('turbo15', startedAt);

    expect(deadline?.toISOString()).toBe('2026-01-01T00:15:00.000Z');
  });

  it('returns null for a mode without a time budget', () => {
    expect(buildDeadline('autonomous', new Date())).toBeNull();
  });
});
