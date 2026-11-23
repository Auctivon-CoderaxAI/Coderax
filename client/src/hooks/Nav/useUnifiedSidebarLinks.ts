import { useMemo } from 'react';
import { MessagesSquare } from 'lucide-react';
import type { NavLink } from '~/common';
import ConversationsSection from '~/components/UnifiedSidebar/ConversationsSection';

/**
 * Keep the sidebar as a chat navigation surface, not a general app launcher.
 * Work shares the chat shell; unrelated tools retain their direct routes.
 */
export default function useUnifiedSidebarLinks() {
  return useMemo<NavLink[]>(
    () => [
      {
        title: 'com_ui_chat_history',
        label: '',
        icon: MessagesSquare,
        id: 'conversations',
        Component: ConversationsSection,
      },
    ],
    [],
  );
}
