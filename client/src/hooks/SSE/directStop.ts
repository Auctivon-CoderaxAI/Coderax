import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';

/** Stop targets this pane's own streaming POST, independently of Work selection changes. */
export const directStreamStopByIndex = atomFamily((_index: number) =>
  atom<(() => void) | null>(null),
);
