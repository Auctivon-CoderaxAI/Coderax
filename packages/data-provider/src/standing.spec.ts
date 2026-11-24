import type { ToolStandingAuthorization } from './standing';
import {
  evaluateStandingAuthorization,
  selectStandingAuthorization,
  validateToolStandingAuthorization,
  STANDING_AUTHORIZATION_MAX_TOOLS,
} from './standing';

const now = 1_700_000_000_000;

const authorization = (
  overrides: Partial<ToolStandingAuthorization> = {},
): ToolStandingAuthorization => ({
  id: 'standing-1',
  label: 'Zero-cost reads',
  tools: ['read_*'],
  createdAt: now - 1000,
  maxCostUsd: 0,
  ...overrides,
});

describe('evaluateStandingAuthorization', () => {
  test('grants a matching zero-cost call', () => {
    expect(evaluateStandingAuthorization(authorization(), { toolName: 'read_file', now })).toEqual({
      allowed: true,
      authorizationId: 'standing-1',
    });
  });

  test('a revoked grant denies even when the tool still matches', () => {
    expect(
      evaluateStandingAuthorization(authorization({ revokedAt: now - 1 }), {
        toolName: 'read_file',
        now,
      }),
    ).toEqual({ allowed: false, reason: 'revoked' });
  });

  test('expiry is exclusive and takes effect on the boundary', () => {
    const expiring = authorization({ expiresAt: now });
    expect(evaluateStandingAuthorization(expiring, { toolName: 'read_file', now })).toEqual({
      allowed: false,
      reason: 'expired',
    });
    expect(
      evaluateStandingAuthorization(
        { ...expiring, expiresAt: now + 1 },
        {
          toolName: 'read_file',
          now,
        },
      ).allowed,
    ).toBe(true);
  });

  test('refuses a grant whose own ceiling is not zero', () => {
    expect(
      evaluateStandingAuthorization(authorization({ maxCostUsd: 0.01 }), {
        toolName: 'read_file',
        now,
      }),
    ).toEqual({ allowed: false, reason: 'cost' });
  });

  test('refuses a call that would spend', () => {
    expect(
      evaluateStandingAuthorization(authorization(), { toolName: 'read_file', costUsd: 1, now }),
    ).toEqual({ allowed: false, reason: 'cost' });
  });

  test('a project-scoped grant needs the request to prove its project', () => {
    const scoped = authorization({ projectId: 'proj-1' });
    expect(evaluateStandingAuthorization(scoped, { toolName: 'read_file', now })).toEqual({
      allowed: false,
      reason: 'project',
    });
    expect(
      evaluateStandingAuthorization(scoped, { toolName: 'read_file', projectId: 'proj-2', now }),
    ).toEqual({ allowed: false, reason: 'project' });
    expect(
      evaluateStandingAuthorization(scoped, { toolName: 'read_file', projectId: 'proj-1', now })
        .allowed,
    ).toBe(true);
  });

  test('a destination-scoped grant needs the request to name that destination', () => {
    const scoped = authorization({ destinations: ['github'] });
    expect(evaluateStandingAuthorization(scoped, { toolName: 'read_file', now })).toEqual({
      allowed: false,
      reason: 'destination',
    });
    expect(
      evaluateStandingAuthorization(scoped, { toolName: 'read_file', destination: 'miro', now }),
    ).toEqual({ allowed: false, reason: 'destination' });
    expect(
      evaluateStandingAuthorization(scoped, { toolName: 'read_file', destination: 'github', now })
        .allowed,
    ).toBe(true);
  });

  test('tool patterns are globs matched case-sensitively', () => {
    const grant = authorization({ tools: ['*_mcp_github'] });
    expect(
      evaluateStandingAuthorization(grant, { toolName: 'list_issues_mcp_github', now }).allowed,
    ).toBe(true);
    expect(evaluateStandingAuthorization(grant, { toolName: 'Read_File', now })).toEqual({
      allowed: false,
      reason: 'tool',
    });
  });
});

describe('selectStandingAuthorization', () => {
  test('returns the first grant that allows the call', () => {
    expect(
      selectStandingAuthorization(
        [
          authorization({ id: 'revoked', revokedAt: now - 1 }),
          authorization({ id: 'narrow', tools: ['write_*'] }),
          authorization({ id: 'granting' }),
        ],
        { toolName: 'read_file', now },
      ),
    ).toEqual({ allowed: true, authorizationId: 'granting' });
  });

  test('reports the first denial rather than a silent miss', () => {
    expect(
      selectStandingAuthorization([authorization({ revokedAt: now - 1 })], {
        toolName: 'read_file',
        now,
      }),
    ).toEqual({ allowed: false, reason: 'revoked' });
  });

  test('an owner with no authorizations misses cleanly', () => {
    expect(selectStandingAuthorization([], { toolName: 'read_file', now })).toEqual({
      allowed: false,
      reason: 'no-match',
    });
  });
});

describe('validateToolStandingAuthorization', () => {
  test('normalizes and dedupes patterns while forcing a zero ceiling', () => {
    expect(
      validateToolStandingAuthorization(
        {
          label: '  Reads  ',
          tools: [' read_file ', 'read_file', '', '*_mcp_github'],
          destinations: [' github ', 'github'],
        },
        now,
      ),
    ).toEqual({
      ok: true,
      value: {
        label: 'Reads',
        tools: ['read_file', '*_mcp_github'],
        destinations: ['github'],
        maxCostUsd: 0,
      },
    });
  });

  test.each([
    [{ label: '  ', tools: ['read_file'] }, 'label'],
    [{ label: 'x', tools: [] }, 'tools'],
    [{ label: 'x', tools: ['read_file'], maxCostUsd: 5 }, 'cost'],
    [{ label: 'x', tools: ['read_file'], expiresAt: now - 1 }, 'expiry'],
    [{ label: 'x', tools: ['read_file'], expiresAt: Number.NaN }, 'expiry'],
  ] as const)('refuses %j with code %s', (input, code) => {
    const result = validateToolStandingAuthorization(input, now);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(code);
  });

  test('caps how many patterns a single grant may carry', () => {
    const tools = Array.from({ length: STANDING_AUTHORIZATION_MAX_TOOLS + 1 }, (_, i) => `t${i}`);
    const result = validateToolStandingAuthorization({ label: 'x', tools }, now);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('tools');
  });
});
