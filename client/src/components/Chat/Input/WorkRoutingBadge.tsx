import { useRef } from 'react';
import * as Ariakit from '@ariakit/react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown } from 'lucide-react';
import { QueryKeys, dataService } from 'coderax-data-provider';
import {
  workActiveEndpoint,
  workPrimaryAvailability,
  workProviderRequestsRemaining,
} from './workProviderState';
import { WorkProviderStatusDetails } from './WorkProviderStatus';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/**
 * The provider and model a new Work turn actually uses, with the full routing
 * snapshot on demand.
 *
 * Rendered only when the deployment opted into zero-cost routing, so the
 * existing composer is untouched everywhere else. The preferred model's
 * unavailability is named next to the active route instead of being hidden,
 * because "DeepSeek-R1" on a distilled model would be a lie. When the server
 * has no routable endpoint left, the badge says so and never implies a paid
 * fallback exists. Opening the badge shows the same provider rows as the model
 * menu, using the snapshot this component already fetched.
 */
export function WorkRoutingBadge() {
  const localize = useLocalize();
  const disclosureRef = useRef<HTMLButtonElement>(null);
  const popover = Ariakit.usePopoverStore({ placement: 'top-start' });
  const open = popover.useState('open');
  const { data } = useQuery({
    queryKey: [QueryKeys.workRouting],
    queryFn: () => dataService.getWorkRouting(),
    retry: false,
    staleTime: 30_000,
  });

  const routing = data?.routing;
  if (!routing?.enabled) {
    return null;
  }

  const active = routing.activeModel;
  const endpoint = active ? workActiveEndpoint(routing) : null;
  const remaining = endpoint ? workProviderRequestsRemaining(endpoint) : null;
  const primary = workPrimaryAvailability(routing);

  return (
    <Ariakit.PopoverProvider store={popover}>
      <Ariakit.PopoverDisclosure
        ref={disclosureRef}
        type="button"
        data-testid="work-routing-badge"
        aria-haspopup="dialog"
        onClick={(event) => event.stopPropagation()}
        className={cn(
          'text-text-secondary flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-xs transition-colors',
          'hover:bg-surface-hover hover:text-text-primary focus-visible:ring-text-primary focus-visible:ring-2 focus-visible:outline-hidden',
          open && 'bg-surface-hover text-text-primary',
        )}
      >
        {active ? (
          <>
            <span className="truncate" title={`${active.provider} · ${active.modelId}`}>
              {localize('com_work_routing_active', { 0: active.label, 1: active.provider })}
            </span>
            {remaining != null && (
              <span className="shrink-0">
                {localize('com_work_routing_requests_left', { 0: String(remaining) })}
              </span>
            )}
            {primary !== 'available' && (
              <span className="truncate">
                {primary === 'unconfigured'
                  ? localize('com_work_routing_primary_unconfigured', {
                      0: routing.primary.label,
                    })
                  : localize('com_work_routing_primary_unavailable', {
                      0: routing.primary.label,
                    })}
              </span>
            )}
          </>
        ) : (
          <>
            <AlertTriangle className="text-text-warning size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{localize('com_work_routing_exhausted')}</span>
          </>
        )}
        <ChevronDown
          className={cn('size-3 shrink-0 opacity-60 transition-transform', open && '-rotate-180')}
          aria-hidden="true"
        />
        <span className="sr-only">{localize('com_work_provider_status')}</span>
      </Ariakit.PopoverDisclosure>
      <Ariakit.Popover
        portal
        gutter={8}
        unmountOnHide
        finalFocus={disclosureRef}
        aria-label={localize('com_work_provider_status')}
        onClick={(event) => event.stopPropagation()}
        hideOnInteractOutside={(event) => !disclosureRef.current?.contains(event.target as Node)}
        className={cn(
          'animate-composer-popover border-border-menu bg-surface-menu rounded-theme-popover z-50 border shadow-lg outline-hidden',
          'max-h-[var(--popover-available-height)] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto p-2.5',
        )}
      >
        <WorkProviderStatusDetails routing={routing} testId="work-provider-status-popover" />
      </Ariakit.Popover>
    </Ariakit.PopoverProvider>
  );
}
