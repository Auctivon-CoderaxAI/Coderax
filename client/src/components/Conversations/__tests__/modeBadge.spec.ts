import { resolveConversationModeBadge } from '../modeBadge';

describe('resolveConversationModeBadge', () => {
  it('badges a conversation the user switched to Work', () => {
    expect(resolveConversationModeBadge('work')).toEqual({
      mode: 'code',
      labelKey: 'com_ui_work',
    });
  });

  it('badges the canonical code value saved by the new conversation-mode model', () => {
    expect(resolveConversationModeBadge('code')).toEqual({
      mode: 'code',
      labelKey: 'com_ui_work',
    });
  });

  it('leaves the Review surface unbadged until it has a distinct label', () => {
    expect(resolveConversationModeBadge('review')).toBeNull();
  });

  it('leaves the default Chat mode unbadged', () => {
    expect(resolveConversationModeBadge('chat')).toBeNull();
  });

  it('leaves a conversation nobody switched unbadged', () => {
    expect(resolveConversationModeBadge(undefined)).toBeNull();
    expect(resolveConversationModeBadge(null)).toBeNull();
  });
});
