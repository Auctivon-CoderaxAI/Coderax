import { atom } from 'jotai';

/** Whether the shell command palette is open. Shared by its ⌘K action and the palette. */
export const commandPaletteOpenAtom = atom(false);
