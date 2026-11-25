import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { SystemRoles } from 'coderax-data-provider';
import { Gamepad2, MessagesSquare, Microscope } from 'lucide-react';
import type { NavLink } from '~/common';
import ConversationsSection from '~/components/UnifiedSidebar/ConversationsSection';
import { useAuthContext } from '~/hooks';

/**
 * Keep the sidebar as a chat navigation surface, not a general app launcher.
 * Work shares the chat shell; unrelated tools retain their direct routes.
 * Game Studio and Research are the exceptions: they are the only entries to
 * the owner's own creativity and evidence records, so they need a destination
 * here instead of a remembered URL. Non-owners get no entry, because both
 * route trees reject them.
 */
export default function useUnifiedSidebarLinks() {
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const isOwner = user?.role === SystemRoles.ADMIN;
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
    if (isOwner) {
      links.push({
        title: 'com_games_title',
        label: '',
        icon: Gamepad2,
        id: 'games',
        onClick: () => navigate('/games'),
      });
      links.push({
        title: 'com_research_title',
        label: '',
        icon: Microscope,
        id: 'research',
        onClick: () => navigate('/research'),
      });
    }
    return links;
  }, [isOwner, navigate]);
}
