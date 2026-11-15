import { createStorageAtom } from './jotai-utils';

/** Messages and the composer span the full pane instead of the reading column. */
export const maximizeChatSpaceAtom = createStorageAtom<boolean>('maximizeChatSpace', false);

/** The welcome-screen composer sits centred rather than at the bottom. */
export const centerFormOnLandingAtom = createStorageAtom<boolean>('centerFormOnLanding', true);
