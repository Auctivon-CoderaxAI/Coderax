import useDrawerViewport from '~/hooks/Nav/useDrawerViewport';
import ConversationModeNav from './ConversationModeNav';
import OpenSidebar from './Menus/OpenSidebar';
import { useLocalize } from '~/hooks';

export default function ModeHeader() {
  const localize = useLocalize();
  const isSmallScreen = useDrawerViewport();

  return (
    <header className="from-surface-canvas via-surface-canvas/70 text-text-primary md:from-surface-canvas/80 md:via-surface-canvas/50 2xl:from-surface-canvas/0 absolute top-0 z-20 flex h-[3.25rem] w-full items-center gap-2 bg-gradient-to-b to-transparent p-2 font-semibold 2xl:via-transparent">
      <div className={isSmallScreen ? 'flex flex-shrink-0 items-center' : 'hidden'}>
        <OpenSidebar />
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
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
  );
}
