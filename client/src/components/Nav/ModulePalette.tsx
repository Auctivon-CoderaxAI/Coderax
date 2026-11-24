import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CommandPalette } from '@coderax/client';
import type { CommandPaletteItem, CommandPaletteLabels } from '@coderax/client';
import { MODULES } from '~/lib/modules/registry';
import { useLocalize } from '~/hooks';

/**
 * The shell's command palette, mounted once by `Root`.
 *
 * It is mounted in the authenticated tree rather than in `App` for two reasons: the
 * destinations it offers only exist behind the auth gate, and `CommandPalette` owns a
 * document-level ⌘K listener that expects exactly one instance per window.
 *
 * The registry supplies destinations; this component supplies the two things the
 * registry deliberately does not know about — localized copy and the router. A row
 * with no route would be a lie, so there are no rows here beyond `MODULES`, and a
 * module that is not built yet is simply not in the list.
 */
export default function ModulePalette() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

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

  return <CommandPalette open={open} onOpenChange={setOpen} items={items} labels={labels} />;
}
