type WorkPermissionCheck<ResourceType, Permission> = (input: {
  userId: string;
  role?: string;
  resourceType: ResourceType;
  resourceId: string;
  requiredPermission: Permission;
}) => Promise<boolean>;

export async function canViewWorkAgent<ResourceType, Permission>(
  input: {
    userId?: string;
    role?: string;
    agentId?: string;
    resourceType: ResourceType;
    requiredPermission: Permission;
  },
  checkPermission: WorkPermissionCheck<ResourceType, Permission>,
): Promise<boolean> {
  const { userId, role, agentId, resourceType, requiredPermission } = input;
  if (!userId || !agentId) {
    return false;
  }
  return checkPermission({
    userId,
    role,
    resourceType,
    resourceId: agentId,
    requiredPermission,
  });
}
