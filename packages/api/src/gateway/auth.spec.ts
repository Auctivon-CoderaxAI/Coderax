import { SystemRoles } from 'coderax-data-provider';
import { requireOwner } from './auth';

const request = (user: unknown) => ({ user }) as never;

describe('WorkflowEngine owner gate', () => {
  it('rejects an unauthenticated request', () => {
    expect(requireOwner(request(undefined))).toEqual({
      ok: false,
      status: 401,
      code: 'WORKFLOW_ENGINE_UNAUTHENTICATED',
    });
  });

  it.each([{}, { id: '' }, { id: '   ' }, { id: 42 }])(
    'rejects a session without a stable identity (%j)',
    (user) => {
      expect(requireOwner(request({ ...user, role: SystemRoles.ADMIN }))).toEqual({
        ok: false,
        status: 401,
        code: 'WORKFLOW_ENGINE_UNAUTHENTICATED',
      });
    },
  );

  it.each([SystemRoles.USER, undefined, 'admin', null])('rejects a non-owner role (%j)', (role) => {
    expect(requireOwner(request({ id: 'user_1', role }))).toEqual({
      ok: false,
      status: 403,
      code: 'WORKFLOW_ENGINE_FORBIDDEN',
    });
  });

  it('returns the authenticated owner identity', () => {
    expect(
      requireOwner(request({ id: 'owner_1', role: SystemRoles.ADMIN, tenantId: 'tenant_1' })),
    ).toEqual({
      ok: true,
      value: { userId: 'owner_1', tenantId: 'tenant_1' },
    });
  });

  it('normalizes whitespace and omits a non-string tenant', () => {
    expect(
      requireOwner(request({ id: ' owner_1 ', role: SystemRoles.ADMIN, tenantId: 7 })),
    ).toEqual({
      ok: true,
      value: { userId: 'owner_1' },
    });
  });

  it('never reads a caller-supplied identity', () => {
    const req = {
      user: { id: 'owner_1', role: SystemRoles.ADMIN },
      body: { userId: 'attacker', ownerId: 'attacker' },
      query: { userId: 'attacker', ownerId: 'attacker' },
    };
    expect(requireOwner(req as never)).toEqual({
      ok: true,
      value: { userId: 'owner_1' },
    });
  });
});
