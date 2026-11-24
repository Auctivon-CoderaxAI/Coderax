type SeedRequest = {
  user?: { id?: string; tenantId?: string | null };
  tenantId?: string | null;
  body?: { conversationId?: string; isTemporary?: boolean };
};

type SeedConversation = {
  conversationId: string;
  tenantId?: string | null;
  isWork?: boolean;
};

export type WorkSeedStore = {
  getConvo: (userId: string, conversationId: string) => Promise<SeedConversation | null>;
  saveConvo: (
    context: { userId: string; isTemporary?: boolean },
    fields: SeedConversation & { workModel: string; workAgent?: 'coderax' | 'opencode' | 'freebuff' },
    options: { context: string; noUpsert?: boolean; appendMessageIds: [] },
  ) => Promise<SeedConversation | null>;
};

/**
 * Work is an execution mode, not a separate conversation type. Promote an owned
 * Chat row in place, keeping its transcript, retention and tenant unchanged.
 */
export async function seedNativeWorkConversation(
  req: SeedRequest,
  context: { workModel: string; workAgent?: 'coderax' | 'opencode' | 'freebuff' },
  source: WorkSeedStore | (() => WorkSeedStore),
): Promise<
  { seeded: true } | { seeded: false; reason: 'no_target' | 'tenant_mismatch' | 'exists' }
> {
  const userId = req.user?.id;
  const conversationId = req.body?.conversationId;
  if (
    !userId ||
    typeof conversationId !== 'string' ||
    !conversationId ||
    conversationId === 'new'
  ) {
    return { seeded: false, reason: 'no_target' };
  }
  const store = typeof source === 'function' ? source() : source;
  const tenantId = req.user?.tenantId ?? req.tenantId ?? null;
  const existing = await store.getConvo(userId, conversationId);
  if (existing && existing.conversationId !== conversationId) {
    throw new Error('Work conversation lookup was not verified');
  }
  if (existing && (existing.tenantId ?? null) !== tenantId) {
    return { seeded: false, reason: 'tenant_mismatch' };
  }
  if (existing?.isWork === true) {
    return { seeded: false, reason: 'exists' };
  }
  const saved = await store.saveConvo(
    { userId, isTemporary: existing ? undefined : req.body?.isTemporary },
    {
      conversationId,
      isWork: true,
      workModel: context.workModel,
      ...(context.workAgent ? { workAgent: context.workAgent } : {}),
      ...(!existing && tenantId != null ? { tenantId } : {}),
    },
    {
      context: 'seed native Work execution',
      ...(existing ? { noUpsert: true } : {}),
      appendMessageIds: [],
    },
  );
  if (
    !saved ||
    saved.conversationId !== conversationId ||
    saved.isWork !== true ||
    (saved.tenantId ?? null) !== tenantId
  ) {
    throw new Error('Work conversation seed was not verified');
  }
  return { seeded: true };
}
