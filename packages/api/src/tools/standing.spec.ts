import type { ToolStandingAuthorization } from 'coderax-data-provider';
import { authorizeStandingWork } from './standing';

const scope = { userId: 'user-1' };

const grant = (overrides: Partial<ToolStandingAuthorization> = {}): ToolStandingAuthorization => ({
  id: 'standing-1',
  label: 'Zero-cost reads',
  tools: ['read_*'],
  createdAt: 1,
  maxCostUsd: 0,
  ...overrides,
});

describe('authorizeStandingWork', () => {
  test('denies when no store or scope is injected', async () => {
    await expect(authorizeStandingWork({ toolName: 'read_file', costUsd: 0 }, {})).resolves.toEqual(
      {
        allowed: false,
        reason: 'unavailable',
      },
    );
    await expect(
      authorizeStandingWork(
        { toolName: 'read_file', costUsd: 0 },
        { storage: { listToolStandingAuthorizations: jest.fn() } },
      ),
    ).resolves.toEqual({ allowed: false, reason: 'unavailable' });
  });

  test('allows a call covered by an active authorization', async () => {
    const storage = { listToolStandingAuthorizations: jest.fn().mockResolvedValue([grant()]) };
    await expect(
      authorizeStandingWork(
        { toolName: 'read_file', projectId: 'proj-1', costUsd: 0 },
        { storage, scope },
      ),
    ).resolves.toEqual({ allowed: true, authorizationId: 'standing-1' });
    expect(storage.listToolStandingAuthorizations).toHaveBeenCalledWith(scope);
  });

  test('denies a call that carries a cost', async () => {
    const storage = { listToolStandingAuthorizations: jest.fn().mockResolvedValue([grant()]) };
    await expect(
      authorizeStandingWork({ toolName: 'read_file', costUsd: 0.5 }, { storage, scope }),
    ).resolves.toEqual({ allowed: false, reason: 'cost' });
  });

  test('denies when the store rejects instead of approving by default', async () => {
    const storage = {
      listToolStandingAuthorizations: jest.fn().mockRejectedValue(new Error('db down')),
    };
    await expect(
      authorizeStandingWork({ toolName: 'read_file', costUsd: 0 }, { storage, scope }),
    ).resolves.toEqual({ allowed: false, reason: 'unavailable' });
  });

  test('denies when the lookup throws synchronously', async () => {
    const storage = {
      listToolStandingAuthorizations: jest.fn(() => {
        throw new Error('sync failure');
      }),
    };
    await expect(
      authorizeStandingWork({ toolName: 'read_file', costUsd: 0 }, { storage, scope }),
    ).resolves.toEqual({ allowed: false, reason: 'unavailable' });
  });

  test('denies when the lookup outlives its budget', async () => {
    const storage = {
      listToolStandingAuthorizations: jest.fn(
        () => new Promise<ToolStandingAuthorization[]>(() => {}),
      ),
    };
    await expect(
      authorizeStandingWork(
        { toolName: 'read_file', costUsd: 0 },
        { storage, scope, timeoutMs: 5 },
      ),
    ).resolves.toEqual({ allowed: false, reason: 'unavailable' });
  });

  test('re-reads on every call, so a revocation binds the next invocation', async () => {
    const list = jest
      .fn()
      .mockResolvedValueOnce([grant()])
      .mockResolvedValueOnce([grant({ revokedAt: 2 })]);
    const gate = { storage: { listToolStandingAuthorizations: list }, scope };

    await expect(
      authorizeStandingWork({ toolName: 'read_file', costUsd: 0 }, gate),
    ).resolves.toEqual({
      allowed: true,
      authorizationId: 'standing-1',
    });
    await expect(
      authorizeStandingWork({ toolName: 'read_file', costUsd: 0 }, gate),
    ).resolves.toEqual({
      allowed: false,
      reason: 'revoked',
    });
    expect(list).toHaveBeenCalledTimes(2);
  });
});
