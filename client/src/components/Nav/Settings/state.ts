import { atom } from 'jotai';

export const settingsOpenAtom = atom(false);

/** Tab a caller wants to open when it opens Settings; its owning tab clears it. */
export const settingsTabAtom = atom<string | null>(null);
