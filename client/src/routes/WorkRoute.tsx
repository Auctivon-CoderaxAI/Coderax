import { useEffect, useMemo, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import {
  ChatTransportContext,
  createWorkChatTransport,
  defaultChatTransport,
} from '~/Providers/ChatTransportContext';
import ModeHeader from '~/components/Chat/ModeHeader';
import NativeWorkHome from './NativeWorkHome';
import ChatRoute from './ChatRoute';

/** Work is a first-party mode of the authenticated agent chat experience. Its
 * generation starts pass through the Work model gate; the native stream,
 * history, cancellation and approval paths remain shared with Chat. */
export default function WorkRoute() {
  const { conversationId } = useParams();
  const location = useLocation();
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
    <main className="bg-surface-canvas text-text-primary relative flex h-full min-h-0 flex-col overflow-hidden">
      <ModeHeader />
      <div className="min-h-0 flex-1 overflow-hidden">
        <ChatTransportContext.Provider value={workChatTransport}>
          <ChatRoute workMode />
        </ChatTransportContext.Provider>
      </div>
    </main>
  );
}
