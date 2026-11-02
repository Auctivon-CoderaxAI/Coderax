import {
  parseApproveWorkflowStep,
  parseCreateWorkflow,
  parseStartWorkflowRun,
  parseUpdateWorkflow,
} from './definition';

const step = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  title: `Step ${id}`,
  instruction: `Do ${id}`,
  ...overrides,
});

const workflow = (overrides: Record<string, unknown> = {}) => ({
  name: 'Release checklist',
  agentId: 'agent-1',
  steps: [step('plan'), step('ship')],
  ...overrides,
});

describe('parseCreateWorkflow', () => {
  it('accepts an ordered workflow and trims text', () => {
    const parsed = parseCreateWorkflow(workflow({ name: '  Release checklist  ' }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.value.name).toBe('Release checklist');
    expect(parsed.value.steps.map((entry) => entry.id)).toEqual(['plan', 'ship']);
  });

  it('rejects duplicate step ids', () => {
    const parsed = parseCreateWorkflow(
      workflow({ steps: [step('plan'), step('plan', { title: 'Plan again' })] }),
    );
    expect(parsed).toEqual({ ok: false, error: 'Step ids must be unique' });
  });

  it('rejects an empty step list', () => {
    const parsed = parseCreateWorkflow(workflow({ steps: [] }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toContain('at least one step');
    }
  });

  it('rejects a step id that cannot be a stable reference', () => {
    const parsed = parseCreateWorkflow(workflow({ steps: [step('has space')] }));
    expect(parsed.ok).toBe(false);
  });

  it('bounds retries on a step', () => {
    const parsed = parseCreateWorkflow(workflow({ steps: [step('plan', { maxAttempts: 99 })] }));
    expect(parsed.ok).toBe(false);
  });
});

describe('parseUpdateWorkflow', () => {
  it('accepts a partial update', () => {
    const parsed = parseUpdateWorkflow({ name: 'Renamed' });
    expect(parsed).toEqual({ ok: true, value: { name: 'Renamed' } });
  });

  it('rejects an empty update', () => {
    const parsed = parseUpdateWorkflow({});
    expect(parsed.ok).toBe(false);
  });

  it('allows clearing a description', () => {
    const parsed = parseUpdateWorkflow({ description: null });
    expect(parsed).toEqual({ ok: true, value: { description: null } });
  });
});

describe('parseStartWorkflowRun', () => {
  it('treats a missing body as an empty input', () => {
    expect(parseStartWorkflowRun(undefined)).toEqual({ ok: true, value: {} });
  });

  it('rejects an oversized input', () => {
    const parsed = parseStartWorkflowRun({ input: 'x'.repeat(8_001) });
    expect(parsed.ok).toBe(false);
  });
});

describe('parseApproveWorkflowStep', () => {
  it('accepts a real step index', () => {
    expect(parseApproveWorkflowStep({ stepIndex: 0 })).toEqual({
      ok: true,
      value: { stepIndex: 0 },
    });
  });

  it('rejects a negative index', () => {
    expect(parseApproveWorkflowStep({ stepIndex: -1 }).ok).toBe(false);
  });
});

describe('workflow graph validation', () => {
  it('accepts dependencies, conditions, a delegated agent and a schedule', () => {
    const parsed = parseCreateWorkflow(
      workflow({
        steps: [
          step('plan'),
          step('review', {
            dependsOn: ['plan'],
            agentId: 'reviewer',
            runIf: { stepId: 'plan', status: 'completed' },
          }),
          step('notify', {
            dependsOn: ['plan'],
            runIf: { stepId: 'plan', status: 'failed' },
          }),
        ],
        settings: { maxParallel: 4 },
        schedule: {
          enabled: true,
          cadence: { frequency: 'daily', hour: 9, minute: 0 },
          timezone: 'UTC',
        },
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.value.steps[1].agentId).toBe('reviewer');
    expect(parsed.value.steps[1].runIf).toEqual({ stepId: 'plan', status: 'completed' });
    expect(parsed.value.settings?.maxParallel).toBe(4);
  });

  it('rejects an unknown dependency', () => {
    const parsed = parseCreateWorkflow(
      workflow({ steps: [step('plan'), step('ship', { dependsOn: ['missing'] })] }),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toContain('unknown step');
    }
  });

  it('rejects a condition step that is not a dependency', () => {
    const parsed = parseCreateWorkflow(
      workflow({
        steps: [
          step('plan'),
          step('ship', {
            dependsOn: ['plan'],
            runIf: { stepId: 'audit', status: 'completed' },
          }),
          step('audit'),
        ],
      }),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toContain('listed as a dependency');
    }
  });

  it('rejects a dependency cycle', () => {
    const parsed = parseCreateWorkflow(
      workflow({
        steps: [step('plan', { dependsOn: ['ship'] }), step('ship', { dependsOn: ['plan'] })],
      }),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toContain('cycle');
    }
  });

  it('bounds parallelism and step timeouts', () => {
    expect(parseCreateWorkflow(workflow({ settings: { maxParallel: 99 } })).ok).toBe(false);
    expect(parseCreateWorkflow(workflow({ steps: [step('plan', { timeoutMs: 1 })] })).ok).toBe(
      false,
    );
  });
});

describe('richer branch and event semantics', () => {
  it('accepts an any-join merge with result-matched conditions', () => {
    const parsed = parseCreateWorkflow(
      workflow({
        steps: [
          step('review'),
          step('audit'),
          step('ship', {
            dependsOn: ['review', 'audit'],
            join: 'any',
            runIf: [
              { stepId: 'review', status: 'completed', resultIncludes: 'APPROVED' },
              { stepId: 'audit', status: 'failed' },
            ],
          }),
        ],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.value.steps[2].join).toBe('any');
    expect(parsed.value.steps[2].runIf).toEqual([
      { stepId: 'review', status: 'completed', resultIncludes: 'APPROVED' },
      { stepId: 'audit', status: 'failed' },
    ]);
  });

  it('rejects more conditions than a step may require', () => {
    const parsed = parseCreateWorkflow(
      workflow({
        steps: [
          step('review'),
          step('ship', {
            dependsOn: ['review'],
            runIf: Array.from({ length: 5 }, () => ({ stepId: 'review' })),
          }),
        ],
      }),
    );
    expect(parsed.ok).toBe(false);
  });

  it('rejects the same condition step twice', () => {
    const parsed = parseCreateWorkflow(
      workflow({
        steps: [
          step('review'),
          step('ship', {
            dependsOn: ['review'],
            runIf: [
              { stepId: 'review', status: 'completed' },
              { stepId: 'review', status: 'failed' },
            ],
          }),
        ],
      }),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toContain('only once');
    }
  });

  it('accepts bounded event subscriptions and rejects duplicate ones', () => {
    const accepted = parseCreateWorkflow(
      workflow({
        eventTriggers: [
          { eventType: 'deploy.failed' },
          { eventType: 'issue.opened', sourceId: 'webhook-1', input: 'Triage the issue.' },
        ],
      }),
    );
    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      expect(accepted.value.eventTriggers).toHaveLength(2);
    }

    const duplicate = parseCreateWorkflow(
      workflow({
        eventTriggers: [
          { eventType: 'deploy.failed', sourceId: 'webhook-1' },
          { eventType: 'deploy.failed', sourceId: 'webhook-1' },
        ],
      }),
    );
    expect(duplicate.ok).toBe(false);

    const malformed = parseCreateWorkflow(
      workflow({ eventTriggers: [{ eventType: 'not a type' }] }),
    );
    expect(malformed.ok).toBe(false);
  });

  it('lets an update clear every event subscription', () => {
    expect(parseUpdateWorkflow({ eventTriggers: null })).toEqual({
      ok: true,
      value: { eventTriggers: null },
    });
  });
});
