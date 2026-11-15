import { createContext, useContext } from 'react';

/** App-level preferences the composer consumes but the host owns and reads. */
export type ComposerPreferences = {
  enterToSend: boolean;
  autoSendText: number;
  speechSettingsInitialized: boolean;
  centerFormOnLanding: boolean;
};

/** The persisted atoms' own defaults, for hosts and tests that supply none. */
const defaultPreferences: ComposerPreferences = {
  enterToSend: true,
  autoSendText: -1,
  speechSettingsInitialized: false,
  centerFormOnLanding: true,
};

const ComposerPreferencesContext = createContext<ComposerPreferences>(defaultPreferences);

export const ComposerPreferencesProvider = ComposerPreferencesContext.Provider;

export function useComposerPreferences(): ComposerPreferences {
  return useContext(ComposerPreferencesContext);
}
