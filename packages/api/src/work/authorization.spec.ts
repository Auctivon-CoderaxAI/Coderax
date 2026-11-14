import { canViewWorkAgent } from './authorization';

describe('Work agent authorization', () => {
  it('does not check permission without both an authenticated user and agent id', async () => {
    const checkPermission = jest.fn();
    await expect(
      canViewWorkAgent(
        { userId: 'user-1', resourceType: 'agent', requiredPermission: 'view' },
        checkPermission,
      ),
    ).resolves.toBe(false);
    await expect(
      canViewWorkAgent(
        { agentId: 'agent-1', resourceType: 'agent', requiredPermission: 'view' },
        checkPermission,
      ),
    ).resolves.toBe(false);
    expect(checkPermission).not.toHaveBeenCalled();
  });

  it('passes the authenticated identity and resource into the injected permission check', async () => {
    const checkPermission = jest.fn().mockResolvedValue(true);
    await expect(
      canViewWorkAgent(
        {
          userId: 'user-1',
          role: 'USER',
          agentId: 'agent-1',
          resourceType: 'agent',
          requiredPermission: 'view',
        },
        checkPermission,
      ),
    ).resolves.toBe(true);
    expect(checkPermission).toHaveBeenCalledWith({
      userId: 'user-1',
      role: 'USER',
      resourceType: 'agent',
      resourceId: 'agent-1',
      requiredPermission: 'view',
    });
  });
});
