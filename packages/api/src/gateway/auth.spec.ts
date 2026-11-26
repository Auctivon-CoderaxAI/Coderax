import { SystemRoles } from 'coderax-data-provider';
import { requireOwner } from './auth';

const request = (user: unknown) => ({ user }) as Parameters<typeof requireOwner>[0];

describe('gateway owner gate', () => {
  it('fails closed when the deployment designates no owner', () => {
    expect(requireOwner(request({ id: 'u1', role: SystemRoles.ADMIN }), {})).toEqual({
      ok: false,
      status: 503,
      code: 'WORKFLOW_ENGINE_OWNER_UNCONFIGURED',
    });
    expect(
      requireOwner(request({ id: 'u1', role: SystemRoles.ADMIN }), { ownerUserId: '  ' }),
    ).toEqual({
      ok: false,
      status: 503,
      code: 'WORKFLOW_ENGINE_OWNER_UNCONFIGURED',
    });
  });

  it('rejects a request without an authenticated identity', () => {
    expect(requireOwner(request(undefined), { ownerUserId: 'owner_1' })).toEqual({
      ok: false,
      status: 401,
      code: 'WORKFLOW_ENGINE_UNAUTHENTICATED',
    });
  });

  it('rejects another administrator: the admin role alone is not ownership', () => {
    expect(
      requireOwner(request({ id: 'admin_2', role: SystemRoles.ADMIN }), { ownerUserId: 'owner_1' }),
    ).toEqual({
      ok: false,
      status: 403,
      code: 'WORKFLOW_ENGINE_FORBIDDEN',
    });
  });

  it('rejects the designated id when it no longer holds the owner role', () => {
    expect(
      requireOwner(request({ id: 'owner_1', role: SystemRoles.USER }), { ownerUserId: 'owner_1' }),
    ).toEqual({
      ok: false,
      status: 403,
      code: 'WORKFLOW_ENGINE_FORBIDDEN',
    });
  });

  it('admits only the designated owner and keeps the tenant scope', () => {
    expect(
      requireOwner(request({ id: 'owner_1', role: SystemRoles.ADMIN, tenantId: 'tenant_1' }), {
        ownerUserId: 'owner_1',
      }),
    ).toEqual({ ok: true, value: { userId: 'owner_1', tenantId: 'tenant_1' } });
  });

  it('never reads identity from the request body or query', () => {
    const forged = {
      user: { id: 'owner_1', role: SystemRoles.ADMIN },
      body: { userId: 'admin_2' },
      query: { userId: 'admin_2' },
    } as unknown as Parameters<typeof requireOwner>[0];
    expect(requireOwner(forged, { ownerUserId: 'owner_1' })).toEqual({
      ok: true,
      value: { userId: 'owner_1' },
    });
  });
});
