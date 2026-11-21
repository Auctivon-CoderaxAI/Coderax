import { resolveConversationModeBadge } from '../modeBadge';

describe('resolveConversationModeBadge', () => {
  it('badges a conversation the user switched to Work', () => {
    expect(resolveConversationModeBadge('work')).toEqual({
      mode: 'work',
      labelKey: 'com_ui_work',
    });
  });

  it('leaves the default Chat mode unbadged', () => {
    expect(resolveConversationModeBadge('chat')).toBeNull();
  });

  it('leaves a conversation nobody switched unbadged', () => {
    expect(resolveConversationModeBadge(undefined)).toBeNull();
    expect(resolveConversationModeBadge(null)).toBeNull();
  });
});
