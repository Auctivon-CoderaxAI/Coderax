import { countUnreadInRecents } from '../unread';

describe('countUnreadInRecents', () => {
  const unseen = [
    { conversationId: 'a' },
    { conversationId: 'b' },
    { conversationId: 'pinned' },
    { conversationId: 'project-only' },
  ];

  it('counts only completions the Recents list holds', () => {
    expect(countUnreadInRecents(unseen, new Set(['a', 'b']))).toBe(2);
  });

  it('ignores a completion filed in a project or pinned elsewhere', () => {
    expect(countUnreadInRecents(unseen, new Set(['a']))).toBe(1);
  });

  it('is zero when every completion inside Recents has been read', () => {
    expect(countUnreadInRecents(unseen, new Set())).toBe(0);
    expect(countUnreadInRecents([], new Set(['a']))).toBe(0);
  });

  it('does not double count a duplicate event for one conversation', () => {
    expect(
      countUnreadInRecents([{ conversationId: 'a' }, { conversationId: 'a' }], new Set(['a'])),
    ).toBe(1);
  });
});
