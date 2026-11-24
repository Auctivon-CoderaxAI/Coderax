import {
  BarChart3,
  Bot,
  FolderKanban,
  LayoutTemplate,
  MessageSquare,
  Search,
  Sparkles,
  SquareTerminal,
  Workflow,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { TranslationKeys } from '~/hooks';

/**
 * The destinations the command palette can reach.
 *
 * One entry per surface that already exists in `client/src/routes/index.tsx`, and
 * nothing else: the palette may offer a module only when pressing Enter lands on a
 * real route, so a planned module is absent rather than listed and dimmed. A module
 * that exists but cannot be opened for this owner belongs here with an
 * `unavailableReason` from the caller, not a disabled row invented at the source.
 *
 * Titles are translation keys, not sentences. The palette localizes them at render
 * time, so the same registry serves every language and a stale English string cannot
 * leak into a translated interface. This list is a starting set, not the ceiling:
 * adding a destination is one entry, which is what lets the palette grow to hundreds
 * of modules without the interface gaining a menu per module.
 */
export interface ModuleDestination {
  /** Stable across renders; the palette tracks the active row by this, not by index. */
  id: string;
  /** The route `Enter` navigates to. */
  path: string;
  /** The module's name, localized by whoever renders the row. */
  titleKey: TranslationKeys;
  icon: LucideIcon;
}

export const MODULES: ModuleDestination[] = [
  { id: 'chat', path: '/c/new', titleKey: 'com_ui_chat', icon: MessageSquare },
  { id: 'work', path: '/work', titleKey: 'com_ui_work', icon: SquareTerminal },
  { id: 'search', path: '/search', titleKey: 'com_ui_search', icon: Search },
  { id: 'projects', path: '/projects', titleKey: 'com_ui_projects', icon: FolderKanban },
  { id: 'skills', path: '/skills', titleKey: 'com_ui_skills', icon: Sparkles },
  { id: 'workflows', path: '/workflows', titleKey: 'com_ui_workflows', icon: Workflow },
  { id: 'insights', path: '/insights', titleKey: 'com_insights_title', icon: BarChart3 },
  { id: 'agents', path: '/agents', titleKey: 'com_ui_agents', icon: Bot },
  { id: 'studio', path: '/studio', titleKey: 'com_ui_studio', icon: LayoutTemplate },
];
