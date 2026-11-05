import useDrawerViewport from '~/hooks/Nav/useDrawerViewport';
import ConversationModeNav from './ConversationModeNav';
import OpenSidebar from './Menus/OpenSidebar';
import { modeHeaderClass } from './layout';
import { useLocalize } from '~/hooks';

export default function ModeHeader() {
  const localize = useLocalize();
  const isSmallScreen = useDrawerViewport();

  return (
    <header className={modeHeaderClass}>
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
