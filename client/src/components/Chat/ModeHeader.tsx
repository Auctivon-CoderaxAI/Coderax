import { modeHeaderClass, modeHeaderEndClass, modeHeaderStartClass } from './layout';
import useDrawerViewport from '~/hooks/Nav/useDrawerViewport';
import ConversationModeNav from './ConversationModeNav';
import OpenSidebar from './Menus/OpenSidebar';
import { useLocalize } from '~/hooks';

export default function ModeHeader() {
  const localize = useLocalize();
  const isSmallScreen = useDrawerViewport();

  return (
    <header className={modeHeaderClass}>
      <div className={modeHeaderStartClass}>
        <div className={isSmallScreen ? 'flex flex-shrink-0 items-center' : 'hidden'}>
          <OpenSidebar />
        </div>
      </div>
      <div className="flex min-w-0 items-center justify-center gap-2">
        <ConversationModeNav
          active="work"
          labels={{
            ariaLabel: localize('com_ui_conversation_mode'),
            chat: localize('com_ui_chat'),
            work: localize('com_ui_work'),
          }}
        />
      </div>
      <div className={modeHeaderEndClass} />
    </header>
  );
}
