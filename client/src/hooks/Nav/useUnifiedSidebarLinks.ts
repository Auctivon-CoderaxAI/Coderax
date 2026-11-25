import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Permissions, PermissionTypes, SystemRoles } from 'coderax-data-provider';
import { CalendarClock, Gamepad2, MessagesSquare, Microscope, Plug } from 'lucide-react';
import type { NavLink } from '~/common';
import ConversationsSection from '~/components/UnifiedSidebar/ConversationsSection';
import { useGetStartupConfig, useResearchCapabilitiesQuery } from '~/data-provider';
import { SchedulePanel } from '~/components/SidePanel/Schedules';
import PluginsPanel from '~/components/Taskbar/PluginsPanel';
import { useAuthContext, useHasAccess } from '~/hooks';

/**
 * The owner's rail is a taskbar: chat history, scheduled tasks, plugins, the
 * owner's creative/research records, and the app shortcuts pinned from More.
 * Work shares the chat shell; unrelated tools retain their direct routes.
 * Game Studio and Research are the owner's own creativity and evidence
 * records, so they need a destination here instead of a remembered URL.
 * Non-owners get no entry, because both route trees reject them.
 */
export default function useUnifiedSidebarLinks() {
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const { data: researchAccess } = useResearchCapabilitiesQuery();
  const isOwner = user?.role === SystemRoles.ADMIN;
  const canAccessResearch = isOwner || researchAccess?.canAccess === true;
  const hasAccessToSchedules = useHasAccess({
    permissionType: PermissionTypes.SCHEDULES,
    permission: Permissions.USE,
  });
  const { data: startupConfig } = useGetStartupConfig();
  const schedulesConfig = startupConfig?.interface?.schedules;
  const schedulesEnabled =
    schedulesConfig != null &&
    schedulesConfig !== false &&
    !(typeof schedulesConfig === 'object' && schedulesConfig.use === false);
  return useMemo<NavLink[]>(() => {
    const links: NavLink[] = [
      {
        title: 'com_ui_chat_history',
        label: '',
        icon: MessagesSquare,
        id: 'conversations',
        Component: ConversationsSection,
      },
    ];
    if (hasAccessToSchedules && schedulesEnabled) {
      links.push({
        title: 'com_ui_taskbar_scheduled',
        label: '',
        icon: CalendarClock,
        id: 'schedules',
        Component: SchedulePanel,
      });
    }
    links.push({
      title: 'com_ui_plugins',
      label: '',
      icon: Plug,
      id: 'plugins',
      Component: PluginsPanel,
    });
    if (isOwner) {
      links.push({
        title: 'com_games_title',
        label: '',
        icon: Gamepad2,
        id: 'games',
        onClick: () => navigate('/games'),
      });
    }
    if (canAccessResearch) {
      links.push({
        title: 'com_research_title',
        label: '',
        icon: Microscope,
        id: 'research',
        onClick: () => navigate('/research'),
      });
    }
    return links;
  }, [canAccessResearch, hasAccessToSchedules, isOwner, navigate, schedulesEnabled]);
}
