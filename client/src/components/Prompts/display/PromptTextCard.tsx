import { useState, useCallback, useRef, useEffect } from 'react';
import { Copy, Check } from 'lucide';
import { Button, MorphIcon, TooltipAnchor, useToastContext } from '@coderax/client';
import { codeNoExecution } from '~/components/Chat/Messages/Content/MarkdownComponents';
import MarkdownLite from '~/components/Chat/Messages/Content/MarkdownLite';
import { PromptVariableGfm } from '../editor/Markdown';
import useLocalize from '~/hooks/useLocalize';

interface PromptTextCardProps {
  mainText: string;
}

const PromptTextCard = ({ mainText }: PromptTextCardProps) => {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [isCopied, setIsCopied] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback(async () => {
    if (isCopied) {
      return;
    }
    try {
      await navigator.clipboard.writeText(mainText);
      setIsCopied(true);
      showToast({
        message: localize('com_ui_copied_to_clipboard'),
        status: 'success',
      });
      timeoutRef.current = setTimeout(() => {
        setIsCopied(false);
      }, 2000);
    } catch {
      showToast({
        message: localize('com_ui_copy_failed'),
        status: 'error',
      });
    }
  }, [mainText, showToast, localize, isCopied]);

  return (
    <div className="border-border-medium relative flex h-full flex-col rounded-xl border bg-transparent">
      <div className="absolute top-2 right-2 z-10">
        <TooltipAnchor
          description={isCopied ? localize('com_ui_copied') : localize('com_ui_copy')}
          render={
            <Button
              size="icon"
              variant="ghost"
              onClick={handleCopy}
              className="size-8 gap-1.5"
              aria-label={
                isCopied ? localize('com_ui_copied') : localize('com_ui_copy_to_clipboard')
              }
              aria-live="polite"
            >
              <MorphIcon icon={isCopied ? Check : Copy} className="text-text-secondary size-4" />
            </Button>
          }
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <MarkdownLite
          content={mainText}
          codeExecution={false}
          components={{ p: PromptVariableGfm, code: codeNoExecution }}
          className="markdown prose dark:prose-invert light text-text-primary my-1 max-w-none break-words"
        />
      </div>
    </div>
  );
};

export default PromptTextCard;
