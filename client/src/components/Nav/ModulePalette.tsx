import { useEffect, useMemo } from 'react';
import { useAtom } from 'jotai';
import { useNavigate } from 'react-router-dom';
import { CommandPalette } from '@coderax/client';
import type { CommandPaletteItem, CommandPaletteLabels } from '@coderax/client';
import { commandPaletteOpenAtom } from '~/store/palette';
import { MODULES } from '~/lib/modules/registry';
import { useLocalize } from '~/hooks';

/**
 * The shell's command palette, mounted once by `Root`.
 *
 * It is mounted in the authenticated tree rather than in `App` because the
 * destinations it offers only exist behind the auth gate.
 *
 * ⌘K is the registered `openCommandPalette` action rather than the primitive's own
 * listener, so the chord appears in the Keyboard Shortcuts dialog, can be rebound,
 * yields to the shortcuts off-switch and takes part in conflict detection. That is
 * why `shortcut` is off here: the two listeners would toggle each other out.
 *
 * The registry supplies destinations; this component supplies the two things the
 * registry deliberately does not know about — localized copy and the router. A row
 * with no route would be a lie, so there are no rows here beyond `MODULES`, and a
 * module that is not built yet is simply not in the list.
 */
export default function ModulePalette() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const [open, setOpen] = useAtom(commandPaletteOpenAtom);

  // The app's store outlives the authenticated shell. Close the palette when the shell leaves.
  useEffect(() => () => setOpen(false), [setOpen]);

  const labels = useMemo<CommandPaletteLabels>(
    () => ({
      title: localize('com_palette_title'),
      placeholder: localize('com_palette_placeholder'),
      empty: localize('com_palette_empty'),
      unavailable: localize('com_palette_unavailable'),
      navigate: localize('com_palette_navigate'),
      open: localize('com_palette_open'),
      close: localize('com_palette_close'),
    }),
    [localize],
  );

  const items = useMemo<CommandPaletteItem[]>(() => {
    const group = localize('com_palette_group_modules');
    return MODULES.map((module) => ({
      id: module.id,
      group,
      title: localize(module.titleKey),
      icon: module.icon,
      onSelect: () => navigate(module.path),
    }));
  }, [localize, navigate]);

  return (
    <CommandPalette
      open={open}
      onOpenChange={setOpen}
      items={items}
      labels={labels}
      shortcut={false}
    />
  );
}
