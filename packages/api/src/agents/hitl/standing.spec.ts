import { createToolPolicyHook } from '@librechat/agents';
import type { TToolApprovalPolicy, ToolStandingAuthorization } from 'coderax-data-provider';
import {
  applyStandingToolAllows,
  resolveStandingAuthorizationRun,
  selectStandingAuthorizationPatterns,
} from './standing';
import { createAgentToolApprovalSession } from './modes';
import { mapToolApprovalPolicy } from './policy';

const now = 1_700_000_000_000;

const grant = (overrides: Partial<ToolStandingAuthorization> = {}): ToolStandingAuthorization => ({
  id: 'standing-1',
  label: 'Zero-cost reads',
  tools: ['read_*'],
  createdAt: now - 1000,
  maxCostUsd: 0,
  ...overrides,
});

const enabled: TToolApprovalPolicy = { enabled: true, mode: 'default' };

const policyDecision = async (
  policy: TToolApprovalPolicy,
  toolName: string,
): Promise<string | undefined> => {
  const result = await createToolPolicyHook(mapToolApprovalPolicy(policy) ?? {})(
    {
      hook_event_name: 'PreToolUse',
      runId: '',
      toolName,
      toolInput: {},
      toolUseId: 'call-1',
    },
    new AbortController().signal,
  );
  return result?.decision;
};

describe('selectStandingAuthorizationPatterns', () => {
  test('collects patterns from active, unscoped grants only', () => {
    expect(
      selectStandingAuthorizationPatterns(
        [
          grant({ id: 'a', tools: ['read_*', 'list_*'] }),
          grant({ id: 'revoked', tools: ['write_*'], revokedAt: now - 1 }),
          grant({ id: 'expired', tools: ['delete_*'], expiresAt: now }),
          grant({ id: 'paid', tools: ['paid_*'], maxCostUsd: 0.01 }),
          grant({ id: 'project', tools: ['proj_*'], projectId: 'project-1' }),
          grant({ id: 'destination', tools: ['dest_*'], destinations: ['github'] }),
        ],
        now,
      ),
    ).toEqual(['read_*', 'list_*']);
  });

  test('dedupes a pattern shared by two grants', () => {
    expect(
      selectStandingAuthorizationPatterns([grant({ id: 'a' }), grant({ id: 'b' })], now),
    ).toEqual(['read_*']);
  });
});

describe('applyStandingToolAllows', () => {
  test('appends patterns to allow without mutating the input policy', () => {
    const policy: TToolApprovalPolicy = { enabled: true, mode: 'default', deny: ['delete_*'] };
    expect(applyStandingToolAllows(policy, ['read_*'])).toEqual({
      enabled: true,
      mode: 'default',
      deny: ['delete_*'],
      allow: ['read_*'],
    });
    expect(policy.allow).toBeUndefined();
  });

  test('is a no-op when the policy is disabled, denying everything, or already lists the pattern', () => {
    const disabled: TToolApprovalPolicy = { enabled: false, mode: 'default' };
    expect(applyStandingToolAllows(disabled, ['read_*'])).toBe(disabled);
    const dontAsk: TToolApprovalPolicy = { enabled: true, mode: 'dontAsk' };
    expect(applyStandingToolAllows(dontAsk, ['read_*'])).toBe(dontAsk);
    const covered: TToolApprovalPolicy = { enabled: true, mode: 'default', allow: ['read_*'] };
    expect(applyStandingToolAllows(covered, ['read_*'])).toBe(covered);
    expect(applyStandingToolAllows(enabled, [])).toBe(enabled);
  });

  test('stops the prompt the run would otherwise show, and only for matching tools', async () => {
    await expect(policyDecision(enabled, 'read_file')).resolves.toBe('ask');
    const folded = applyStandingToolAllows(enabled, ['read_*']) as TToolApprovalPolicy;
    await expect(policyDecision(folded, 'read_file')).resolves.toBe('allow');
    await expect(policyDecision(folded, 'write_file')).resolves.toBe('ask');
  });

  test('administrator deny and ask still outrank a standing grant', async () => {
    const denied = applyStandingToolAllows({ enabled: true, mode: 'default', deny: ['read_*'] }, [
      'read_*',
    ]) as TToolApprovalPolicy;
    await expect(policyDecision(denied, 'read_file')).resolves.toBe('deny');

    const asked = applyStandingToolAllows({ enabled: true, mode: 'default', ask: ['read_file'] }, [
      'read_*',
    ]) as TToolApprovalPolicy;
    await expect(policyDecision(asked, 'read_file')).resolves.toBe('ask');
  });
});

describe('resolveStandingAuthorizationRun', () => {
  const scope = { userId: 'user-1' };

  test('does not read storage when approval policy is off or denying everything', async () => {
    const list = jest.fn();
    await expect(
      resolveStandingAuthorizationRun({
        policy: { enabled: false, mode: 'default' },
        storage: { listToolStandingAuthorizations: list },
        scope,
      }),
    ).resolves.toMatchObject({ patterns: [] });
    await expect(
      resolveStandingAuthorizationRun({
        policy: { enabled: true, mode: 'dontAsk' },
        storage: { listToolStandingAuthorizations: list },
        scope,
      }),
    ).resolves.toMatchObject({ patterns: [] });
    expect(list).not.toHaveBeenCalled();
  });

  test('fails closed when the store is unavailable at run start', async () => {
    const run = await resolveStandingAuthorizationRun({
      policy: enabled,
      storage: { listToolStandingAuthorizations: jest.fn().mockRejectedValue(new Error('down')) },
      scope,
    });
    expect(run.patterns).toEqual([]);
    await expect(run.guard.assert('read_file')).resolves.toBeUndefined();
  });

  test('folds the grant and re-verifies it per covered call', async () => {
    const list = jest.fn().mockResolvedValue([grant()]);
    const run = await resolveStandingAuthorizationRun({
      policy: enabled,
      storage: { listToolStandingAuthorizations: list },
      scope,
    });

    expect(run.patterns).toEqual(['read_*']);

    await expect(run.guard.assert('read_file')).resolves.toBeUndefined();
    // An uncovered tool never triggers a second read.
    await expect(run.guard.assert('write_file')).resolves.toBeUndefined();
    expect(list).toHaveBeenCalledTimes(2);
  });

  test('a revocation after the run started refuses the covered call', async () => {
    const list = jest
      .fn()
      .mockResolvedValueOnce([grant()])
      .mockResolvedValueOnce([grant({ revokedAt: now - 1 })]);
    const run = await resolveStandingAuthorizationRun({
      policy: enabled,
      storage: { listToolStandingAuthorizations: list },
      scope,
    });
    await expect(run.guard.assert('read_file')).rejects.toThrow(/expired or was revoked/);
  });

  test('an unreadable store mid-run refuses rather than assumes approval', async () => {
    const list = jest.fn().mockResolvedValueOnce([grant()]).mockResolvedValueOnce(null);
    const run = await resolveStandingAuthorizationRun({
      policy: enabled,
      storage: { listToolStandingAuthorizations: list },
      scope,
    });
    await expect(run.guard.assert('read_file')).rejects.toThrow(/could not be verified/);
  });
});

describe('run pause path', () => {
  test('re-checks a standing grant before an agent-mode-less tool executes', async () => {
    const standing = { assert: jest.fn().mockRejectedValue(new Error('standing revoked')) };
    const session = createAgentToolApprovalSession({
      agents: [{ id: 'agent-1' }],
      standing,
    });
    await expect(
      session.validateExecution({ name: 'read_file' }, { agentId: 'agent-1', toolCallId: 'c1' }),
    ).rejects.toThrow('standing revoked');
    expect(standing.assert).toHaveBeenCalledWith('read_file');
  });

  test('delegates every mode-less tool to the guard', async () => {
    const assert = jest.fn().mockResolvedValue(undefined);
    const session = createAgentToolApprovalSession({
      agents: [{ id: 'agent-1' }],
      standing: { assert },
    });
    await expect(
      session.validateExecution({ name: 'read_file' }, { agentId: 'agent-1', toolCallId: 'c1' }),
    ).resolves.toBeUndefined();
    expect(assert).toHaveBeenCalledWith('read_file');
  });
});
