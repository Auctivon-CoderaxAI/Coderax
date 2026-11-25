import {
  Bot,
  Code2,
  FolderKanban,
  Github,
  Globe,
  HardDrive,
  HeartPulse,
  Image,
  Mail,
  Map as MapIcon,
  Notebook,
  Palette,
  PenTool,
  Sparkles,
  Workflow,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { TranslationKeys } from '~/hooks';
import { createStorageAtom } from '~/store/jotai-utils';

export type TaskbarCategory = 'work' | 'create' | 'apps';

export interface TaskbarApp {
  id: string;
  label: TranslationKeys;
  category: TaskbarCategory;
  icon: LucideIcon;
  /** An in-app destination. Exactly one of `path` or `href` is set. */
  path?: string;
  /** An external app, opened in a new tab. */
  href?: string;
}

export const TASKBAR_CATEGORIES: TaskbarCategory[] = ['work', 'create', 'apps'];

export const TASKBAR_CATEGORY_LABELS: Record<TaskbarCategory, TranslationKeys> = {
  work: 'com_ui_taskbar_category_work',
  create: 'com_ui_taskbar_category_create',
  apps: 'com_ui_taskbar_category_apps',
};

/**
 * The owner's launcher. Internal entries are existing Coderax surfaces;
 * external entries are honest shortcuts to the named app, not claimed
 * integrations. Adding an entry here makes it available in More and Plugins.
 */
export const TASKBAR_APPS: TaskbarApp[] = [
  {
    id: 'projects',
    label: 'com_ui_projects',
    category: 'work',
    icon: FolderKanban,
    path: '/projects',
  },
  {
    id: 'workflows',
    label: 'com_ui_taskbar_workflows',
    category: 'work',
    icon: Workflow,
    path: '/workflows',
  },
  {
    id: 'skills',
    label: 'com_ui_taskbar_skills',
    category: 'work',
    icon: Sparkles,
    path: '/skills',
  },
  {
    id: 'images',
    label: 'com_ui_taskbar_images',
    category: 'create',
    icon: Image,
    path: '/studio',
  },
  {
    id: 'gpts',
    label: 'com_ui_taskbar_gpts',
    category: 'create',
    icon: Bot,
    path: '/agents',
  },
  {
    id: 'sites',
    label: 'com_ui_taskbar_sites',
    category: 'create',
    icon: Globe,
    href: 'https://sites.google.com',
  },
  {
    id: 'maps',
    label: 'com_ui_taskbar_maps',
    category: 'apps',
    icon: MapIcon,
    href: 'https://maps.google.com',
  },
  {
    id: 'code-review',
    label: 'com_ui_taskbar_code_review',
    category: 'apps',
    icon: Code2,
    href: 'https://github.com/Auctivon-CoderaxAI/Coderax/pulls',
  },
  {
    id: 'health',
    label: 'com_ui_taskbar_health',
    category: 'apps',
    icon: HeartPulse,
    path: '/insights',
  },
  {
    id: 'notion',
    label: 'com_ui_taskbar_notion',
    category: 'apps',
    icon: Notebook,
    href: 'https://www.notion.so',
  },
  {
    id: 'canva',
    label: 'com_ui_taskbar_canva',
    category: 'apps',
    icon: Palette,
    href: 'https://www.canva.com',
  },
  {
    id: 'adobe',
    label: 'com_ui_taskbar_adobe',
    category: 'apps',
    icon: PenTool,
    href: 'https://www.adobe.com',
  },
  {
    id: 'gmail',
    label: 'com_ui_taskbar_gmail',
    category: 'apps',
    icon: Mail,
    href: 'https://mail.google.com',
  },
  {
    id: 'github',
    label: 'com_ui_taskbar_github',
    category: 'apps',
    icon: Github,
    href: 'https://github.com',
  },
  {
    id: 'drive',
    label: 'com_ui_taskbar_drive',
    category: 'apps',
    icon: HardDrive,
    href: 'https://drive.google.com',
  },
];

export const TASKBAR_APP_BY_ID = new Map<string, TaskbarApp>(
  TASKBAR_APPS.map((app) => [app.id, app] as const),
);

export const DEFAULT_TASKBAR_PINS = ['projects', 'images'];

/** Per-owner taskbar membership, persisted locally like the other rail prefs. */
export const taskbarPinsAtom = createStorageAtom<string[]>('taskbar:pins', DEFAULT_TASKBAR_PINS);

export const isExternalTaskbarApp = (app: TaskbarApp): app is TaskbarApp & { href: string } =>
  app.href != null;
