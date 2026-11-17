import {
  saveGuestWorkHandoffDraft,
  takeGuestWorkHandoffDraft,
} from './guestWorkHandoff';

const sessionKey = 'coderax-guest-work-owner-handoff';

describe('guest Work owner handoff', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('stores the typed text in this tab and consumes it once for the matching return id', () => {
    const id = saveGuestWorkHandoffDraft('Keep this task text');

    expect(id).toBeTruthy();
    expect(JSON.parse(sessionStorage.getItem(sessionKey) ?? '{}')).toMatchObject({
      id,
      text: 'Keep this task text',
    });
    expect(takeGuestWorkHandoffDraft('different-id')).toBeNull();
    expect(takeGuestWorkHandoffDraft(id!)).toBe('Keep this task text');
    expect(takeGuestWorkHandoffDraft(id!)).toBeNull();
    expect(sessionStorage.getItem(sessionKey)).toBeNull();
  });

  it('does not create a handoff record for an empty composer', () => {
    expect(saveGuestWorkHandoffDraft('')).toBeNull();
    expect(sessionStorage.getItem(sessionKey)).toBeNull();
  });
});
