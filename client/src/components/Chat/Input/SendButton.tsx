import React, { forwardRef } from 'react';
import { AudioLines } from 'lucide-react';
import { useWatch } from 'react-hook-form';
import { SendIcon, IconButton, TooltipAnchor } from '@coderax/client';
import type { Control } from 'react-hook-form';
import { isSubmittableMessage } from '~/utils';
import { useLocalize } from '~/hooks';

type SendButtonProps = {
  disabled: boolean;
  control: Control<{ text: string }>;
  /** Number of attached files; attachments allow sending without text */
  fileCount?: number;
  /** The landing composer's larger, brand-colored action circle. */
  landing?: boolean;
};

const SubmitButton = React.memo(
  forwardRef(
    (
      props: { disabled: boolean; landing?: boolean },
      ref: React.ForwardedRef<HTMLButtonElement>,
    ) => {
      const localize = useLocalize();
      return (
        <TooltipAnchor
          description={localize('com_nav_send_message')}
          render={
            <IconButton
              ref={ref}
              label={localize('com_nav_send_message')}
              variant={props.landing ? 'brand' : 'submit'}
              size={props.landing ? 'xl' : 'theme'}
              shape={props.landing ? 'round' : 'composer'}
              disabled={props.disabled}
              data-testid="send-button"
              type="submit"
            >
              <span className="" data-state="closed">
                {props.landing ? (
                  <AudioLines className="size-6" aria-hidden="true" />
                ) : (
                  <SendIcon className="size-6" />
                )}
              </span>
            </IconButton>
          }
        />
      );
    },
  ),
);
const SendButton = React.memo(
  forwardRef((props: SendButtonProps, ref: React.ForwardedRef<HTMLButtonElement>) => {
    const data = useWatch({ control: props.control });
    const canSubmit = isSubmittableMessage(data?.text, props.fileCount);
    return (
      <SubmitButton ref={ref} disabled={props.disabled || !canSubmit} landing={props.landing} />
    );
  }),
);

export default SendButton;
