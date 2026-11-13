import type { WorkSeedStore } from './seed';
import { seedNativeWorkConversation } from './seed';

function store(existing: Awaited<ReturnType<WorkSeedStore['getConvo']>> = null) {
  const getConvo = jest.fn(async () => existing);
  const saveConvo = jest.fn<
    ReturnType<WorkSeedStore['saveConvo']>,
    Parameters<WorkSeedStore['saveConvo']>
  >(async (_context, fields) => ({ ...existing, ...fields }));
  return { getConvo, saveConvo };
}

const request = {
  user: { id: 'owner', tenantId: 'tenant-a' },
  body: { conversationId: 'same-conversation' },
};

describe('shared conversation Work admission', () => {
  it('does not resolve database wiring before a persisted identity exists', async () => {
    const resolveStore = jest.fn(() => {
      throw new Error('database must not load');
    });
    await expect(
      seedNativeWorkConversation(
        { user: request.user, body: { conversationId: 'new' } },
        { workModel: 'local' },
        resolveStore,
      ),
    ).resolves.toEqual({ seeded: false, reason: 'no_target' });
    expect(resolveStore).not.toHaveBeenCalled();
  });

  it('rejects a mismatched lookup identity before changing metadata', async () => {
    const db = store({ conversationId: 'different-conversation', tenantId: 'tenant-a' });
    await expect(seedNativeWorkConversation(request, { workModel: 'local' }, db)).rejects.toThrow(
      'Work conversation lookup was not verified',
    );
    expect(db.saveConvo).not.toHaveBeenCalled();
  });

  it('promotes only execution metadata on the existing owned conversation', async () => {
    const db = store({ conversationId: 'same-conversation', tenantId: 'tenant-a' });
    await expect(seedNativeWorkConversation(request, { workModel: 'local' }, db)).resolves.toEqual({
      seeded: true,
    });
    expect(db.getConvo).toHaveBeenCalledWith('owner', 'same-conversation');
    expect(db.saveConvo).toHaveBeenCalledWith(
      { userId: 'owner', isTemporary: undefined },
      { conversationId: 'same-conversation', isWork: true, workModel: 'local' },
      { context: 'seed native Work execution', noUpsert: true, appendMessageIds: [] },
    );
  });

  it('rejects a foreign tenant without modifying storage', async () => {
    const db = store({ conversationId: 'same-conversation', tenantId: 'tenant-b' });
    await expect(seedNativeWorkConversation(request, { workModel: 'local' }, db)).resolves.toEqual({
      seeded: false,
      reason: 'tenant_mismatch',
    });
    expect(db.saveConvo).not.toHaveBeenCalled();
  });

  it('does not re-seed an existing Work conversation', async () => {
    const db = store({
      conversationId: 'same-conversation',
      tenantId: 'tenant-a',
      isWork: true,
    });
    expect(await seedNativeWorkConversation(request, { workModel: 'local' }, db)).toEqual({
      seeded: false,
      reason: 'exists',
    });
    expect(db.saveConvo).not.toHaveBeenCalled();
  });

  it('propagates operational read failures rather than treating an outage as absence', async () => {
    const db = store();
    db.getConvo.mockRejectedValue(new Error('database unavailable'));
    await expect(seedNativeWorkConversation(request, { workModel: 'local' }, db)).rejects.toThrow(
      'database unavailable',
    );
    expect(db.saveConvo).not.toHaveBeenCalled();
  });

  it('rejects an unverified write, including a row deleted during promotion', async () => {
    const db = store({ conversationId: 'same-conversation', tenantId: 'tenant-a' });
    db.saveConvo.mockResolvedValue(null);
    await expect(seedNativeWorkConversation(request, { workModel: 'local' }, db)).rejects.toThrow(
      'Work conversation seed was not verified',
    );
  });
});
