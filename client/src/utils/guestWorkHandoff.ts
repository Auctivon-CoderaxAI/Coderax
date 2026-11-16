const SESSION_KEY = 'coderax-guest-work-owner-handoff';
const HANDOFF_TTL_MS = 10 * 60 * 1000;

export const GUEST_WORK_HANDOFF_PARAM = '_work_handoff';

type GuestWorkHandoff = {
  id: string;
  text: string;
  createdAt: number;
};

const createHandoffId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch {
      // The id only correlates this one-tab handoff; use a local fallback where UUID is unavailable.
    }
  }
  return `handoff-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

const readHandoff = (): GuestWorkHandoff | null => {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) {
      return null;
    }
    const value = JSON.parse(raw) as Partial<GuestWorkHandoff> | null;
    if (
      value == null ||
      typeof value.id !== 'string' ||
      typeof value.text !== 'string' ||
      typeof value.createdAt !== 'number'
    ) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    if (Date.now() - value.createdAt > HANDOFF_TTL_MS || value.createdAt > Date.now()) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return value as GuestWorkHandoff;
  } catch {
    return null;
  }
};

/** Stores only the typed message text for the explicit Guest-to-owner Work handoff. */
export const saveGuestWorkHandoffDraft = (text: string): string | null => {
  try {
    const current = readHandoff();
    if (text === '') {
      if (current) {
        sessionStorage.removeItem(SESSION_KEY);
      }
      return null;
    }
    const id = createHandoffId();
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id, text, createdAt: Date.now() }));
    return id;
  } catch {
    return null;
  }
};

/** Consumes a handoff once, only when its opaque id returns with the owner Work URL. */
export const takeGuestWorkHandoffDraft = (id: string): string | null => {
  const handoff = readHandoff();
  if (!handoff || handoff.id !== id) {
    return null;
  }
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // A storage cleanup failure must not discard the already-read draft.
  }
  return handoff.text;
};
