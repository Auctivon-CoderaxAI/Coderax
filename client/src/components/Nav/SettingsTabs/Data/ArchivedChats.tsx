import { useRef, useState } from 'react';
import { Label, Button } from '@coderax/client';
import { ArchivedChatsModal } from '../General/ArchivedChatsModal';
import { useLocalize } from '~/hooks';

export const ArchivedChats = () => {
  const localize = useLocalize();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  return (
    <div className="flex items-center justify-between">
      <Label id="archived-chats-label">{localize('com_nav_archived_chats')}</Label>
      <Button
        ref={triggerRef}
        variant="outline"
        onClick={() => setOpen(true)}
        aria-labelledby="archived-chats-label"
      >
        {localize('com_ui_manage')}
      </Button>
      {open && <ArchivedChatsModal open={open} onOpenChange={setOpen} triggerRef={triggerRef} />}
    </div>
  );
};
