import { memo } from 'react';
import { Wrench } from 'lucide-react';
import { useLocalize } from '~/hooks';
import type { ConversationModeBadgeDescriptor } from './modeBadge';

/** Marks a conversation the user switched out of Chat, so a list that mixes modes
 *  says which rows are which without opening them. Icon-only so the row keeps its
 *  width; the label rides along as the row's description, like ProjectBadge. */
function ConversationModeBadge({
  badge,
  labelId,
}: {
  badge: ConversationModeBadgeDescriptor;
  labelId: string;
}) {
  const localize = useLocalize();
  const label = localize(badge.labelKey);

  return (
    <span
      className="text-text-secondary mr-1 flex shrink-0 items-center"
      title={label}
      data-testid="convo-mode-badge"
    >
      <Wrench className="icon-sm" aria-hidden="true" />
      <span id={labelId} className="sr-only">
        {label}
      </span>
    </span>
  );
}

export default memo(ConversationModeBadge);
