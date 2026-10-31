import { useEffect, useMemo, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import {
  ChatTransportContext,
  createWorkChatTransport,
  defaultChatTransport,
} from '~/Providers/ChatTransportContext';
import ConversationModeNav from '~/components/Chat/ConversationModeNav';
import OpenSidebar from '~/components/Chat/Menus/OpenSidebar';
import useDrawerViewport from '~/hooks/Nav/useDrawerViewport';
import NativeWorkHome from './NativeWorkHome';
import { useLocalize } from '~/hooks';
import ChatRoute from './ChatRoute';

/** Work is a first-party mode of the authenticated agent chat experience. Its
 * generation starts pass through the Work model gate; the native stream,
 * history, cancellation and approval paths remain shared with Chat. */
export default function WorkRoute() {
  const { conversationId } = useParams();
  const location = useLocation();
  const localize = useLocalize();
  const isSmallScreen = useDrawerViewport();
  const searchParams = new URLSearchParams(location.search);
  const prompt = searchParams.get('prompt') ?? searchParams.get('q');
  const shouldStartPrompt =
    conversationId === 'new' &&
    searchParams.get('submit')?.toLowerCase() === 'true' &&
    Boolean(prompt?.trim());
  /** URL submission handling removes its prompt flags once it has taken
   * ownership of the draft. Keep `/work/new` mounted until that first task has
   * moved to its persisted conversation route. */
  const [startingPrompt, setStartingPrompt] = useState(shouldStartPrompt);
  useEffect(() => {
    if (shouldStartPrompt) {
      setStartingPrompt(true);
    } else if (conversationId !== 'new') {
      setStartingPrompt(false);
    }
  }, [conversationId, shouldStartPrompt]);
  const showChat =
    Boolean(conversationId && conversationId !== 'new') || shouldStartPrompt || startingPrompt;
  const workChatTransport = useMemo(() => createWorkChatTransport(defaultChatTransport), []);

  if (!showChat) {
    return <NativeWorkHome />;
  }

  return (
    <main className="bg-surface-primary text-text-primary flex h-full min-h-0 flex-col overflow-hidden">
      <header className="from-surface-canvas via-surface-canvas/70 flex h-[3.25rem] shrink-0 items-center gap-2 bg-gradient-to-b to-transparent p-2 font-semibold">
        <div className={isSmallScreen ? 'flex flex-shrink-0 items-center' : 'hidden'}>
          <OpenSidebar />
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <ConversationModeNav
            active="work"
            labels={{
              ariaLabel: localize('com_cyvox_conversation_mode'),
              chat: localize('com_cyvox_chat'),
              work: localize('com_cyvox_work'),
            }}
          />
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">
        <ChatTransportContext.Provider value={workChatTransport}>
          <ChatRoute workMode />
        </ChatTransportContext.Provider>
      </div>
    </main>
  );
}
