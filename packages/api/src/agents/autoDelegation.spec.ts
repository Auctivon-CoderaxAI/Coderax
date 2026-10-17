import {
  AUTOMATIC_DELEGATION_INSTRUCTIONS,
  applyAutomaticDelegation,
  automaticDelegationDecision,
  isComplexRequest,
  latestUserRequest,
} from './autoDelegation';

describe('automatic subagent delegation policy', () => {
  it('recognizes complex user requests and keeps simple chat direct', () => {
    expect(
      isComplexRequest(
        'Compare two deployment designs, explain the trade-offs, and recommend one.',
      ),
    ).toBe(true);
    expect(isComplexRequest('What does this error mean?')).toBe(false);
    expect(isComplexRequest('approve A1B2-C3D4')).toBe(false);
  });

  it('extracts only the latest user message from the current request payload', () => {
    expect(
      latestUserRequest({
        messages: [
          { role: 'user', content: 'Earlier request.' },
          { role: 'assistant', content: 'Assistant response.' },
          {
            role: 'user',
            content: [{ type: 'text', text: 'Compare the options and evaluate the risks.' }],
          },
        ],
      }),
    ).toBe('Compare the options and evaluate the risks.');
  });

  it('requires the deployment capability and respects a per-agent opt-out', () => {
    const text = 'Compare two deployment designs and recommend one with reasons.';
    expect(
      automaticDelegationDecision({
        text,
        capabilityEnabled: true,
        subagentsConfig: undefined,
        runtimeAvailable: true,
      }),
    ).toEqual({ delegate: true, reason: 'complex-request' });
    expect(
      automaticDelegationDecision({
        text,
        capabilityEnabled: false,
        subagentsConfig: undefined,
        runtimeAvailable: true,
      }).reason,
    ).toBe('capability-disabled');
    expect(
      automaticDelegationDecision({
        text,
        capabilityEnabled: true,
        subagentsConfig: { enabled: false },
        runtimeAvailable: true,
      }).reason,
    ).toBe('agent-disabled');
    expect(
      automaticDelegationDecision({
        text,
        capabilityEnabled: true,
        subagentsConfig: undefined,
        runtimeAvailable: false,
      }).reason,
    ).toBe('runtime-unavailable');
  });

  it('defines bounded, permission-preserving orchestration behavior', () => {
    expect(AUTOMATIC_DELEGATION_INSTRUCTIONS).toMatch(/up to two focused subtasks/);
    expect(AUTOMATIC_DELEGATION_INSTRUCTIONS).toMatch(/approval gates/);
    expect(AUTOMATIC_DELEGATION_INSTRUCTIONS).toMatch(/Do not recursively delegate/);
  });

  it('activates isolated self-delegation only for an authorized complex turn', () => {
    const result = applyAutomaticDelegation({
      text: 'Compare the database options and recommend one with operational trade-offs.',
      capabilityEnabled: true,
      subagentsConfig: undefined,
      runtimeAvailable: true,
      additionalInstructions: 'Keep answers concise.',
    });
    expect(result.delegate).toBe(true);
    expect(result.subagentsConfig).toEqual({ enabled: true, allowSelf: true, shareFiles: false });
    expect(result.additionalInstructions).toContain('Keep answers concise.');
    expect(result.additionalInstructions).toContain(AUTOMATIC_DELEGATION_INSTRUCTIONS);
  });

  it('preserves configured agents and does not change an opted-out agent', () => {
    const configured = { enabled: true, allowSelf: false, agent_ids: ['authorized-reviewer'] };
    const delegated = applyAutomaticDelegation({
      text: 'Compare the database options and recommend one with operational trade-offs.',
      capabilityEnabled: true,
      subagentsConfig: configured,
      runtimeAvailable: true,
    });
    expect(delegated.subagentsConfig).toBe(configured);

    const disabled = applyAutomaticDelegation({
      text: 'Compare the database options and recommend one with operational trade-offs.',
      capabilityEnabled: true,
      subagentsConfig: { enabled: false },
      runtimeAvailable: true,
    });
    expect(disabled.delegate).toBe(false);
    expect(disabled.subagentsConfig).toEqual({ enabled: false });
  });
});
