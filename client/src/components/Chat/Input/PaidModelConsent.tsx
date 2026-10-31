import { OGDialog, OGDialogTemplate } from '@coderax/client';
import { useLocalize } from '~/hooks';

/**
 * Chat never offers provider or model configuration. When no free or local
 * model is eligible, the submission is held here and the user must explicitly
 * approve the paid request before it is sent.
 */
export default function PaidModelConsent({
  open,
  model,
  pricing,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  model: string;
  pricing: { prompt: string; completion: string } | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const localize = useLocalize();

  return (
    <OGDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onCancel();
        }
      }}
    >
      <OGDialogTemplate
        className="sm:max-w-md"
        title={localize('com_ui_paid_model_consent_title')}
        main={
          <div className="text-text-secondary space-y-2 px-6 pb-2 text-sm">
            <p>{localize('com_ui_paid_model_consent_message', { 0: model })}</p>
            <p>
              {pricing
                ? localize('com_ui_paid_model_consent_pricing', {
                    0: pricing.prompt,
                    1: pricing.completion,
                  })
                : localize('com_ui_paid_model_consent_pricing_unknown')}
            </p>
          </div>
        }
        selection={{
          selectHandler: onConfirm,
          selectText: localize('com_ui_paid_model_consent_continue'),
          selectClasses: 'bg-surface-submit text-text-on-status hover:bg-surface-submit-hover',
        }}
        showCancelButton={true}
        footerClassName="flex justify-end gap-2 px-6 pb-6 pt-2"
      />
    </OGDialog>
  );
}
