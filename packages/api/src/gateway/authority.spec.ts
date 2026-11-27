import type { ConversationAuthorityStore } from './authority';
import { createConversationAuthority, createMemoryAuthorityStore } from './authority';

function authorityFor(
  store: ConversationAuthorityStore = createMemoryAuthorityStore(),
  bootstrapConversations: string[] = ['conv_1'],
) {
  return {
    store,
    authority: createConversationAuthority({
      store,
      contractVersion: '1.0.0',
      bootstrapConversations,
    }),
  };
}

const scope = { ownerId: 'owner_1', mode: 'private' as const };

describe('conversation authority', () => {
  it('refuses a conversation the migration has not mapped', async () => {
    const { authority } = authorityFor();
    await expect(authority.admit({ ...scope, conversationId: 'conv_unknown' })).resolves.toEqual({
      ok: false,
      status: 409,
      code: 'WORKFLOW_ENGINE_AUTHORITY_UNMAPPED',
    });
  });

  it('maps a bootstrapped conversation on first admission and fences the claim', async () => {
    const { authority, store } = authorityFor();
    await expect(authority.admit({ ...scope, conversationId: 'conv_1' })).resolves.toEqual({
      ok: true,
      generation: 1,
    });
    await expect(store.read('owner_1', 'conv_1')).resolves.toMatchObject({
      engine: 'workflow-engine',
      state: 'active',
      generation: 1,
      inFlight: 1,
      receipts: [expect.objectContaining({ outcome: 'dispatched', generation: 1 })],
    });

    await expect(
      authority.settle({
        ownerId: 'owner_1',
        conversationId: 'conv_1',
        generation: 1,
        outcome: 'settled',
      }),
    ).resolves.toBe(true);
    await expect(store.read('owner_1', 'conv_1')).resolves.toMatchObject({
      generation: 2,
      inFlight: 0,
    });
  });

  it('retains only the configured number of receipts', async () => {
    const store = createMemoryAuthorityStore();
    const authority = createConversationAuthority({
      store,
      contractVersion: '1.0.0',
      bootstrapConversations: ['conv_1'],
      maxReceipts: 2,
    });
    for (const outcome of ['settled', 'settled'] as const) {
      const claim = await authority.admit({ ...scope, conversationId: 'conv_1' });
      if (!claim.ok) {
        throw new Error('claim refused');
      }
      await authority.settle({
        ownerId: 'owner_1',
        conversationId: 'conv_1',
        generation: claim.generation,
        outcome,
      });
    }

    const record = await store.read('owner_1', 'conv_1');
    expect(record?.receipts.map((receipt) => receipt.outcome)).toEqual(['dispatched', 'settled']);
  });

  it('refuses a conversation the native engine owns', async () => {
    const store = createMemoryAuthorityStore();
    await store.create({
      ownerId: 'owner_1',
      conversationId: 'conv_native',
      mode: 'private',
      engine: 'native',
      state: 'active',
      generation: 0,
      inFlight: 0,
      contractVersion: '1.0.0',
      receipts: [],
      updatedAt: new Date(0).toISOString(),
    });
    const { authority } = authorityFor(store);
    await expect(authority.admit({ ...scope, conversationId: 'conv_native' })).resolves.toEqual({
      ok: false,
      status: 409,
      code: 'WORKFLOW_ENGINE_AUTHORITY_CONFLICT',
    });
  });

  it('fences a stale replica whose generation has moved', async () => {
    const inner = createMemoryAuthorityStore();
    const store: ConversationAuthorityStore = {
      read: async (ownerId, conversationId) => {
        const record = await inner.read(ownerId, conversationId);
        // The first replica keeps reading generation 1; a second replica has
        // already advanced the record, so its next write must match nothing.
        return record == null ? null : { ...record, generation: 1 };
      },
      create: inner.create,
      advance: inner.advance,
    };
    const { authority } = authorityFor(store);
    await authority.admit({ ...scope, conversationId: 'conv_1' });
    await authority.settle({
      ownerId: 'owner_1',
      conversationId: 'conv_1',
      generation: 1,
      outcome: 'settled',
    });
    await expect(authority.admit({ ...scope, conversationId: 'conv_1' })).resolves.toEqual({
      ok: false,
      status: 409,
      code: 'WORKFLOW_ENGINE_AUTHORITY_BUSY',
    });
  });

  it('requires settlement before a conversation may migrate', async () => {
    const { authority } = authorityFor();
    await authority.admit({ ...scope, conversationId: 'conv_1' });
    await expect(
      authority.beginMigration({
        ownerId: 'owner_1',
        conversationId: 'conv_1',
        to: 'native',
      }),
    ).resolves.toEqual({
      ok: false,
      status: 409,
      code: 'WORKFLOW_ENGINE_AUTHORITY_BUSY',
    });

    await authority.settle({
      ownerId: 'owner_1',
      conversationId: 'conv_1',
      generation: 1,
      outcome: 'settled',
    });
    await expect(
      authority.beginMigration({
        ownerId: 'owner_1',
        conversationId: 'conv_1',
        to: 'native',
      }),
    ).resolves.toEqual({ ok: true, generation: 3 });

    await expect(authority.admit({ ...scope, conversationId: 'conv_1' })).resolves.toEqual({
      ok: false,
      status: 409,
      code: 'WORKFLOW_ENGINE_AUTHORITY_MIGRATION_PENDING',
    });
    await expect(
      authority.completeMigration({
        ownerId: 'owner_1',
        conversationId: 'conv_1',
        generation: 3,
      }),
    ).resolves.toBe(true);
    await expect(authority.admit({ ...scope, conversationId: 'conv_1' })).resolves.toEqual({
      ok: false,
      status: 409,
      code: 'WORKFLOW_ENGINE_AUTHORITY_CONFLICT',
    });
  });

  it('keeps its authority across a service restart', async () => {
    const store = createMemoryAuthorityStore();
    const first = authorityFor(store);
    await first.authority.admit({ ...scope, conversationId: 'conv_1' });
    await first.authority.settle({
      ownerId: 'owner_1',
      conversationId: 'conv_1',
      generation: 1,
      outcome: 'settled',
    });

    // A new process over the same durable store still sees the mapping.
    const restarted = authorityFor(store);
    await expect(restarted.authority.read('owner_1', 'conv_1')).resolves.toMatchObject({
      engine: 'workflow-engine',
      inFlight: 0,
      generation: 2,
    });
  });

  it('registers a conversation the engine itself created without claiming it', async () => {
    const { authority, store } = authorityFor();
    await expect(authority.register({ ...scope, conversationId: 'conv_new' })).resolves.toEqual({
      ok: true,
      generation: 0,
    });
    await expect(store.read('owner_1', 'conv_new')).resolves.toMatchObject({
      engine: 'workflow-engine',
      state: 'active',
      inFlight: 0,
      generation: 0,
    });
  });

  it('settles an indeterminate dispatch without releasing it as a failure', async () => {
    const { authority, store } = authorityFor();
    await authority.admit({ ...scope, conversationId: 'conv_1' });
    await expect(
      authority.settle({
        ownerId: 'owner_1',
        conversationId: 'conv_1',
        generation: 1,
        outcome: 'indeterminate',
      }),
    ).resolves.toBe(true);
    await expect(store.read('owner_1', 'conv_1')).resolves.toMatchObject({
      inFlight: 0,
      generation: 2,
      receipts: [
        expect.objectContaining({ outcome: 'dispatched' }),
        expect.objectContaining({ outcome: 'indeterminate' }),
      ],
    });
  });

  it('refuses another dispatch while the previous claim is in flight', async () => {
    const { authority } = authorityFor();
    const first = await authority.admit({ ...scope, conversationId: 'conv_1' });
    expect(first.ok).toBe(true);
    await expect(authority.admit({ ...scope, conversationId: 'conv_1' })).resolves.toEqual({
      ok: false, status: 409, code: 'WORKFLOW_ENGINE_AUTHORITY_BUSY',
    });
  });

  it('keeps conversations isolated by owner', async () => {
    const { authority, store } = authorityFor();
    await authority.admit({ ...scope, conversationId: 'conv_1' });
    await authority.settle({
      ownerId: 'owner_1',
      conversationId: 'conv_1',
      generation: 1,
      outcome: 'settled',
    });
    // Another identity gets its own record; the owner's record is untouched.
    await expect(
      authority.admit({ ...scope, ownerId: 'owner_2', conversationId: 'conv_1' }),
    ).resolves.toEqual({ ok: true, generation: 1 });
    await expect(store.read('owner_1', 'conv_1')).resolves.toMatchObject({
      ownerId: 'owner_1',
      generation: 2,
      inFlight: 0,
    });
    await expect(store.read('owner_2', 'conv_1')).resolves.toMatchObject({
      ownerId: 'owner_2',
      generation: 1,
      inFlight: 1,
    });
  });
});
