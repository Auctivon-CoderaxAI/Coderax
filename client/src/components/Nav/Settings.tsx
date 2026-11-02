import { lazy, Suspense, useEffect } from 'react';
import { useAtom } from 'jotai';
import { settingsOpenAtom, settingsTabAtom } from './Settings/state';

export { settingsOpenAtom, settingsTabAtom };

/** Keep settings lazy without tying its lifetime to a responsive account-menu trigger. */
const SettingsDialog = lazy(() => import('./Settings/Dialog'));

export default function Settings() {
  const [open, setOpen] = useAtom(settingsOpenAtom);

  useEffect(() => () => setOpen(false), [setOpen]);

  return open ? (
    <Suspense fallback={null}>
      <SettingsDialog open={open} onOpenChange={setOpen} />
    </Suspense>
  ) : null;
}
