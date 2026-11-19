import type { PlannerCompletion } from './planner';
import {
  createHeuristicBuildPlan,
  extractPlanJson,
  heuristicRoleAgents,
  planBuild,
} from './planner';

const MODEL = { provider: 'local', model: 'test-planner', cost: 'local' as const };

function validPlan(): Record<string, unknown> {
  return {
    name: 'Add a health endpoint',
    request: 'ignored by the adapter',
    tasks: [
      {
        id: 'research',
        title: 'Inspect the server',
        role: 'research',
        instruction: 'Read the server routes and record the existing conventions.',
        acceptance: ['Existing route conventions are recorded'],
        dependsOn: [],
      },
      {
        id: 'backend',
        title: 'Add the endpoint',
        role: 'backend',
        instruction: 'Add a health endpoint with a focused test.',
        acceptance: ['The endpoint returns 200', 'A focused test covers the endpoint'],
        dependsOn: ['research'],
      },
      {
        id: 'testing',
        title: 'Run verification',
        role: 'testing',
        instruction: 'Run the tests and build and record the results.',
        acceptance: ['The test command passes'],
        dependsOn: ['backend'],
      },
      {
        id: 'review',
        title: 'Review the diff',
        role: 'reviewer',
        instruction: 'Review the diff and open a reviewable pull request.',
        acceptance: ['A pull request is open'],
        dependsOn: ['testing'],
      },
    ],
  };
}

function completing(...responses: string[]): PlannerCompletion {
  let index = 0;
  return async () => responses[Math.min(index++, responses.length - 1)];
}

describe('planBuild', () => {
  it('extracts fenced JSON and compiles a validated plan', async () => {
    const result = await planBuild({
      request: 'Add a health endpoint',
      mode: 'autonomous',
      orchestratorAgentId: 'agent-1',
      model: MODEL,
      complete: completing(`Here you go:\n\`\`\`json\n${JSON.stringify(validPlan())}\n\`\`\``),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.attempts).toBe(1);
    expect(result.value.plan.request).toBe('Add a health endpoint');
    expect(result.value.compiled.workflow.name).toBe('Add a health endpoint');
    expect(result.value.compiled.workflow.steps).toHaveLength(4);
    expect(result.value.compiled.requiredGates).toContain('tests');
  });

  it('retries a malformed response with validation feedback', async () => {
    const prompts: string[] = [];
    const complete: PlannerCompletion = async (input) => {
      prompts.push(input.prompt);
      return prompts.length === 1 ? 'not a plan' : JSON.stringify(validPlan());
    };
    const result = await planBuild({
      request: 'Add a health endpoint',
      mode: 'autonomous',
      orchestratorAgentId: 'agent-1',
      model: MODEL,
      complete,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.attempts).toBe(2);
    expect(prompts[1]).toContain('rejected');
  });

  it('never calls a paid planner', async () => {
    let called = false;
    const result = await planBuild({
      request: 'Add a health endpoint',
      mode: 'autonomous',
      orchestratorAgentId: 'agent-1',
      model: { provider: 'paid', model: 'large', cost: 'paid' },
      complete: async () => {
        called = true;
        return JSON.stringify(validPlan());
      },
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'paid_model' } });
    expect(called).toBe(false);
  });

  it('rejects an empty request and reports a failed model', async () => {
    await expect(
      planBuild({
        request: '   ',
        mode: 'autonomous',
        orchestratorAgentId: 'agent-1',
        model: MODEL,
        complete: async () => JSON.stringify(validPlan()),
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'empty_request' } });

    await expect(
      planBuild({
        request: 'Add a health endpoint',
        mode: 'autonomous',
        orchestratorAgentId: 'agent-1',
        model: MODEL,
        complete: async () => {
          throw new Error('planner offline');
        },
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'model_failed' } });
  });

  it('returns invalid_plan after exhausting attempts without a valid object', async () => {
    const result = await planBuild({
      request: 'Add a health endpoint',
      mode: 'autonomous',
      orchestratorAgentId: 'agent-1',
      model: MODEL,
      complete: async () => JSON.stringify({ name: 'broken', tasks: [] }),
      maxAttempts: 2,
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_plan' } });
  });

  it('extracts JSON from surrounding prose', () => {
    expect(extractPlanJson('nope')).toBeUndefined();
    expect(extractPlanJson('prefix {"name":"x"} suffix')).toEqual({ name: 'x' });
  });
});

describe('createHeuristicBuildPlan', () => {
  it('builds a valid frontend plan with verification and review', () => {
    const result = createHeuristicBuildPlan('Add a save button to the settings page');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const roles = result.value.tasks.map((task) => task.role);
    expect(roles).toEqual(expect.arrayContaining(['research', 'frontend', 'testing', 'reviewer']));
    const testing = result.value.tasks.find((task) => task.id === 'testing');
    const review = result.value.tasks.find((task) => task.id === 'review');
    expect(testing?.dependsOn).toContain('frontend');
    expect(review?.dependsOn).toEqual(['testing']);
    expect(result.value.request).toBe('Add a save button to the settings page');
  });

  it('adds database, security and devops tasks when the request spans those surfaces', () => {
    const result = createHeuristicBuildPlan(
      'Add OAuth login to the API, store sessions in the database, and update the CI deployment pipeline',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const roles = result.value.tasks.map((task) => task.role);
    expect(roles).toEqual(
      expect.arrayContaining([
        'research',
        'architecture',
        'database',
        'backend',
        'security',
        'devops',
        'testing',
        'reviewer',
      ]),
    );
    const security = result.value.tasks.find((task) => task.id === 'security');
    expect(security?.dependsOn).toEqual(expect.arrayContaining(['backend', 'database']));
  });

  it('rejects an empty request and an over-long request', () => {
    expect(createHeuristicBuildPlan('')).toMatchObject({ ok: false });
    expect(createHeuristicBuildPlan('x'.repeat(9_000))).toMatchObject({ ok: false });
  });

  it('binds the orchestrator role and preserves explicit specialists', () => {
    expect(heuristicRoleAgents('agent-1', { backend: 'agent-2' })).toEqual({
      orchestrator: 'agent-1',
      backend: 'agent-2',
    });
  });
});
