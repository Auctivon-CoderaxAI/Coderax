import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import PluginsPanel from './PluginsPanel';
import { useLocalize } from '~/hooks';

/** A short grace period so moving from the rail into the preview does not dismiss it. */
const CLOSE_DELAY_MS = 160;

export default function PluginsHoverPanel({ onClose }: { onClose: () => void }) {
  const localize = useLocalize();
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimer.current != null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(onClose, CLOSE_DELAY_MS);
  }, [cancelClose, onClose]);

  useEffect(() => () => cancelClose(), [cancelClose]);

  return createPortal(
    <>
      <div
        aria-hidden="true"
        data-testid="plugins-hover-backdrop"
        className="fixed inset-y-0 right-0 left-16 z-[80] bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label={localize('com_ui_plugins')}
        data-testid="plugins-hover-panel"
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
        className="border-border-light bg-surface-secondary fixed inset-y-0 left-16 z-[81] flex w-[310px] max-w-[calc(100vw-5rem)] flex-col border-r shadow-2xl"
      >
        <PluginsPanel />
      </div>
    </>,
    document.body,
  );
}
