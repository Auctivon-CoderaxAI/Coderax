import { parseStartBuild, prepareBuildLaunch } from './start';

describe('parseStartBuild', () => {
  it('accepts a minimal valid request and a known role assignment', () => {
    expect(
      parseStartBuild({
        request: ' Add a health endpoint ',
        mode: 'turbo15',
        agentId: 'agent-1',
        roleAgents: { backend: 'agent-2' },
      }),
    ).toEqual({
      ok: true,
      value: {
        request: 'Add a health endpoint',
        mode: 'turbo15',
        agentId: 'agent-1',
        roleAgents: { backend: 'agent-2' },
      },
    });
  });

  it('rejects an empty request, unknown mode and unknown role', () => {
    expect(parseStartBuild({ request: ' ', mode: 'turbo15', agentId: 'a' })).toMatchObject({
      ok: false,
    });
    expect(parseStartBuild({ request: 'x', mode: 'fast', agentId: 'a' })).toMatchObject({
      ok: false,
    });
    expect(
      parseStartBuild({
        request: 'x',
        mode: 'autonomous',
        agentId: 'a',
        roleAgents: { wizard: 'b' },
      }),
    ).toMatchObject({ ok: false });
  });

  it('rejects a request longer than a workflow run input', () => {
    expect(
      parseStartBuild({ request: 'x'.repeat(9_000), mode: 'autonomous', agentId: 'a' }),
    ).toMatchObject({ ok: false });
  });
});

describe('prepareBuildLaunch', () => {
  it('compiles a validated plan into a workflow with evidence gates', () => {
    const result = prepareBuildLaunch({
      request: 'Add a health endpoint to the API',
      mode: 'autonomous',
      agentId: 'agent-1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.plan.tasks.length).toBeGreaterThanOrEqual(4);
    expect(result.value.compiled.workflow.agentId).toBe('agent-1');
    expect(result.value.compiled.workflow.steps.length).toBe(result.value.plan.tasks.length);
    expect(result.value.compiled.requiredGates).toEqual(
      expect.arrayContaining(['tests', 'build', 'review']),
    );
    expect(result.value.decision.mode).toBe('autonomous');
  });

  it('degrades an oversized turbo request instead of promising 15 minutes', () => {
    const result = prepareBuildLaunch({
      request:
        'Add OAuth login, a database migration, a settings UI, a CI deployment pipeline, security review and a new API for sessions',
      mode: 'turbo15',
      agentId: 'agent-1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision.mode).toBe('autonomous');
    expect(result.value.decision.degraded).toBe(true);
    expect(result.value.decision.reason).toBeTruthy();
  });

  it('binds an explicit specialist role to its agent', () => {
    const result = prepareBuildLaunch({
      request: 'Add database persistence for user sessions',
      mode: 'autonomous',
      agentId: 'agent-1',
      roleAgents: { database: 'agent-db' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.compiled.roleAssignments).toEqual(
      expect.arrayContaining([{ role: 'database', agentId: 'agent-db', configured: true }]),
    );
  });
});
