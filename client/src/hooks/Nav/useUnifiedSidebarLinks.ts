import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { EModelEndpoint, Permissions, PermissionTypes, SystemRoles } from 'coderax-data-provider';
import { Bot, CalendarClock, Gamepad2, MessagesSquare, Microscope } from 'lucide-react';
import type { NavLink } from '~/common';
import ConversationsSection from '~/components/UnifiedSidebar/ConversationsSection';
import {
  useGetEndpointsQuery,
  useGetStartupConfig,
  useResearchCapabilitiesQuery,
} from '~/data-provider';
import { SchedulePanel } from '~/components/SidePanel/Schedules';
import AgentPanelSwitch from '~/components/SidePanel/Agents/AgentPanelSwitch';
import { useAuthContext, useHasAccess } from '~/hooks';

/**
 * Keep the sidebar as a chat navigation surface, not a general app launcher.
 * Scheduled chats keep a management entry so owners can pause existing jobs.
 * Work shares the chat shell; unrelated tools retain their direct routes.
 * Game Studio and Research are the exceptions: they are the only entries to
 * the owner's own creativity and evidence records, so they need a destination
 * here instead of a remembered URL. Non-owners get no entry, because both
 * route trees reject them.
 */
export default function useUnifiedSidebarLinks() {
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const { data: researchAccess } = useResearchCapabilitiesQuery();
  const { data: startupConfig } = useGetStartupConfig();
  const hasScheduleAccess = useHasAccess({
    permissionType: PermissionTypes.SCHEDULES,
    permission: Permissions.USE,
  });
  const hasAccessToAgents = useHasAccess({
    permissionType: PermissionTypes.AGENTS,
    permission: Permissions.USE,
  });
  const hasAccessToCreateAgents = useHasAccess({
    permissionType: PermissionTypes.AGENTS,
    permission: Permissions.CREATE,
  });
  const { data: endpointsConfig } = useGetEndpointsQuery();
  const schedulesConfig = startupConfig?.interface?.schedules;
  const canAccessSchedules =
    hasScheduleAccess &&
    schedulesConfig != null &&
    schedulesConfig !== false &&
    !(typeof schedulesConfig === 'object' && schedulesConfig.use === false);
  const isOwner = user?.role === SystemRoles.ADMIN;
  const canAccessResearch = isOwner || researchAccess?.canAccess === true;
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
    if (
      endpointsConfig?.[EModelEndpoint.agents] &&
      hasAccessToAgents &&
      hasAccessToCreateAgents &&
      endpointsConfig[EModelEndpoint.agents].disableBuilder !== true
    ) {
      links.push({
        title: 'com_sidepanel_agent_builder',
        label: '',
        icon: Bot,
        id: EModelEndpoint.agents,
        Component: AgentPanelSwitch,
      });
    }
    if (canAccessSchedules) {
      links.push({
        title: 'com_ui_schedules',
        label: '',
        icon: CalendarClock,
        id: 'schedules',
        Component: SchedulePanel,
      });
    }
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
  }, [
    canAccessResearch,
    canAccessSchedules,
    endpointsConfig,
    hasAccessToAgents,
    hasAccessToCreateAgents,
    isOwner,
    navigate,
  ]);
}
