import { JSX } from 'react/jsx-runtime';
import { Archive, Ban, Circle, CircleDashed, CircleDot, FlaskConical } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Chip } from './Chip';
import { cn } from '~/utils';

/**
 * The six words the interface is allowed to use about what a module can do.
 *
 * This is the presentation vocabulary only. The capability registry keeps the same
 * words as data and is the record of truth; a badge never decides a status, it shows
 * the one it is given. `ProductStatus` in `packages/product-registry` is a different,
 * narrower vocabulary consumed by the CLI and Electron, and is deliberately not
 * widened to include these.
 */
export type CapabilityStatus =
  | 'live'
  | 'preview'
  | 'experimental'
  | 'planned'
  | 'blocked'
  | 'retired';

type ChipTone = 'surface' | 'neutral' | 'info' | 'success' | 'warning' | 'error';

/**
 * Icon and tone per status. Colour is a family, not the status: `planned` and
 * `retired` share the neutral family, `experimental` and `blocked` share warning.
 * The word and the icon carry the meaning, which is also what keeps the badge
 * legible without colour (WCAG 1.4.1).
 *
 * `blocked` uses the warning family until the `status-blocked` token lands with theme
 * coverage; when it does, only the tone in this table changes.
 */
const STATUS_PRESENTATION: Record<CapabilityStatus, { icon: LucideIcon; tone: ChipTone }> = {
  live: { icon: CircleDot, tone: 'success' },
  preview: { icon: CircleDashed, tone: 'info' },
  experimental: { icon: FlaskConical, tone: 'warning' },
  planned: { icon: Circle, tone: 'neutral' },
  blocked: { icon: Ban, tone: 'warning' },
  retired: { icon: Archive, tone: 'surface' },
};

export interface CapabilityBadgeProps {
  status: CapabilityStatus;
  /** The status word, localized by the caller — a badge never invents copy. */
  label: string;
  /**
   * Why the capability is in this state. Rendered as an inline sentence, not only as
   * a tooltip: a control the owner cannot use has to say why in the same breath.
   */
  reason?: string;
  /** Set false where the surrounding screen already states the reason. */
  showReason?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

export default function CapabilityBadge({
  status,
  label,
  reason,
  showReason = true,
  size = 'sm',
  className,
}: CapabilityBadgeProps): JSX.Element {
  const { icon: Icon, tone } = STATUS_PRESENTATION[status];
  const hasReason = reason != null && reason !== '';

  const badge = (
    <Chip
      tone={tone}
      size={size}
      shape="round"
      title={hasReason ? reason : undefined}
      className={cn('shrink-0', className)}
      leading={<Icon className={size === 'sm' ? 'size-3' : 'size-3.5'} aria-hidden={true} />}
    >
      {label}
    </Chip>
  );

  if (!hasReason || !showReason) {
    return badge;
  }

  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      {badge}
      <span className="text-text-tertiary min-w-0 text-xs">{reason}</span>
    </span>
  );
}
