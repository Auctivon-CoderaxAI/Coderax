import type { BuildPlan } from './plan';
import { assessBuildPlan, criticalPathTaskIds, parseBuildPlan, resolveBuildLayers } from './plan';

const task = (overrides: Record<string, unknown> = {}) => ({
  id: 'research',
  title: 'Research the repository',
  role: 'research',
  instruction: 'Inspect the repository and record what already exists.',
  acceptance: ['The findings name the relevant files'],
  ...overrides,
});

function expectPlan(value: unknown): BuildPlan {
  const result = parseBuildPlan(value);
  if (!result.ok) {
    throw new Error(`Expected a valid plan: ${result.error.message}`);
  }
  return result.value;
}

function expectError(value: unknown): { code: string; message: string } {
  const result = parseBuildPlan(value);
  if (result.ok) {
    throw new Error('Expected the plan to be rejected');
  }
  return result.error;
}

describe('parseBuildPlan', () => {
  it('resolves omitted dependencies to the previous task and applies defaults', () => {
    const plan = expectPlan({
      name: 'Build a service',
      request: 'Build the service',
      tasks: [task({ id: 'inspect' }), task({ id: 'implement', role: 'backend' })],
    });

    expect(plan.tasks[0].dependsOn).toEqual([]);
    expect(plan.tasks[1].dependsOn).toEqual(['inspect']);
    expect(plan.tasks[0].maxAttempts).toBe(2);
    expect(plan.tasks[0].requiresApproval).toBe(false);
  });

  it('preserves an explicit empty dependency list so independent roots can run in parallel', () => {
    const plan = expectPlan({
      name: 'Two roots',
      request: 'Two independent reads',
      tasks: [
        task({ id: 'first', dependsOn: [] }),
        task({ id: 'second', dependsOn: [] }),
        task({ id: 'merge', role: 'reviewer', dependsOn: ['first', 'second'] }),
      ],
    });

    expect(plan.tasks[0].dependsOn).toEqual([]);
    expect(plan.tasks[1].dependsOn).toEqual([]);
  });

  it('deduplicates acceptance criteria and dependencies', () => {
    const plan = expectPlan({
      name: 'Dedupe',
      request: 'Check duplicates',
      tasks: [
        task({ id: 'one' }),
        task({
          id: 'two',
          role: 'testing',
          dependsOn: ['one', 'one'],
          acceptance: ['Tests pass', 'Tests pass', 'Report the command'],
        }),
      ],
    });

    expect(plan.tasks[1].dependsOn).toEqual(['one']);
    expect(plan.tasks[1].acceptance).toEqual(['Tests pass', 'Report the command']);
  });

  it('rejects duplicate task ids', () => {
    const error = expectError({
      name: 'Duplicate',
      request: 'Duplicate ids',
      tasks: [task({ id: 'same' }), task({ id: 'same' })],
    });

    expect(error.code).toBe('invalid_plan');
    expect(error.message).toMatch(/unique/i);
  });

  it('rejects an unknown dependency', () => {
    const error = expectError({
      name: 'Unknown dep',
      request: 'Missing dependency',
      tasks: [task({ id: 'one', dependsOn: ['missing'] })],
    });

    expect(error.message).toMatch(/unknown task/i);
  });

  it('rejects a self dependency', () => {
    const error = expectError({
      name: 'Self dep',
      request: 'Self dependency',
      tasks: [task({ id: 'one', dependsOn: ['one'] })],
    });

    expect(error.message).toMatch(/cannot depend on itself/i);
  });

  it('rejects a dependency cycle', () => {
    const result = parseBuildPlan({
      name: 'Cycle',
      request: 'Cycle',
      tasks: [task({ id: 'a', dependsOn: ['b'] }), task({ id: 'b', dependsOn: ['a'] })],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('cycle');
    }
  });

  it('requires at least one acceptance criterion per task', () => {
    const error = expectError({
      name: 'No acceptance',
      request: 'No acceptance',
      tasks: [task({ acceptance: [] })],
    });

    expect(error.message).toMatch(/acceptance criterion/i);
  });

  it('rejects an unknown role', () => {
    const error = expectError({
      name: 'Bad role',
      request: 'Bad role',
      tasks: [task({ role: 'marketing' })],
    });

    expect(error.code).toBe('invalid_plan');
  });

  it('rejects more tasks than a workflow can hold', () => {
    const error = expectError({
      name: 'Too many',
      request: 'Too many tasks',
      tasks: Array.from({ length: 26 }, (_, index) => task({ id: `task-${index}` })),
    });

    expect(error.code).toBe('invalid_plan');
  });
});

describe('resolveBuildLayers', () => {
  it('groups independent tasks and gates dependants into later layers', () => {
    const plan = expectPlan({
      name: 'Layers',
      request: 'Layer plan',
      tasks: [
        task({ id: 'a', dependsOn: [] }),
        task({ id: 'b', dependsOn: [] }),
        task({ id: 'c', role: 'frontend', dependsOn: ['a'] }),
        task({ id: 'd', role: 'backend', dependsOn: ['a', 'b'] }),
      ],
    });

    const layers = resolveBuildLayers(plan);
    expect(layers.ok).toBe(true);
    if (layers.ok) {
      expect(layers.value.map((layer) => layer.taskIds)).toEqual([
        ['a', 'b'],
        ['c', 'd'],
      ]);
    }
  });
});

describe('criticalPathTaskIds', () => {
  it('returns the longest dependency chain', () => {
    const plan = expectPlan({
      name: 'Path',
      request: 'Path plan',
      tasks: [
        task({ id: 'a', dependsOn: [] }),
        task({ id: 'b', dependsOn: ['a'] }),
        task({ id: 'c', dependsOn: ['b'] }),
        task({ id: 'd', dependsOn: ['a'] }),
      ],
    });

    expect(criticalPathTaskIds(plan)).toEqual(['a', 'b', 'c']);
  });
});

describe('assessBuildPlan', () => {
  it('names the roles and requires security review for security claims', () => {
    const plan = expectPlan({
      name: 'Security',
      request: 'Review authorization',
      tasks: [
        task({
          id: 'build',
          role: 'backend',
          acceptance: ['Authorization denies cross-tenant access'],
        }),
        task({ id: 'review', role: 'reviewer', dependsOn: ['build'] }),
      ],
    });

    const assessment = assessBuildPlan(plan);
    expect(assessment.taskCount).toBe(2);
    expect(assessment.roles).toEqual(['backend', 'reviewer']);
    expect(assessment.hasReviewTask).toBe(true);
    expect(assessment.requiresSecurityReview).toBe(true);
    expect(assessment.criticalPathLength).toBe(2);
  });
});
