import { useQuery } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'coderax-data-provider';
import {
  AlertTriangle,
  CheckCircle2,
  CircleMinus,
  Clock3,
  HelpCircle,
  KeyRound,
} from 'lucide-react';
import type { TWorkRoutingEndpoint, TWorkRoutingSnapshot } from 'coderax-data-provider';
import type { WorkPrimaryAvailability, WorkProviderAvailability } from './workProviderState';
import {
  workPrimaryAvailability,
  workProviderAvailability,
  workProviderRequestsRemaining,
} from './workProviderState';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

function availabilityLabel(
  state: WorkProviderAvailability,
  localize: ReturnType<typeof useLocalize>,
): string {
  switch (state) {
    case 'available':
      return localize('com_work_provider_available');
    case 'quota_exhausted':
      return localize('com_work_provider_quota_exhausted');
    case 'cooling_down':
      return localize('com_work_provider_cooling_down');
    case 'unavailable':
      return localize('com_work_provider_unavailable');
    default:
      return localize('com_work_provider_unavailable');
  }
}

function primaryLabel(
  state: WorkPrimaryAvailability,
  localize: ReturnType<typeof useLocalize>,
): string {
  switch (state) {
    case 'available':
      return localize('com_work_provider_available');
    case 'unconfigured':
      return localize('com_work_provider_unconfigured');
    case 'unverified':
      return localize('com_work_provider_unverified');
    default:
      return localize('com_work_provider_unverified');
  }
}

function StateIcon({ state }: { state: WorkProviderAvailability | WorkPrimaryAvailability }) {
  switch (state) {
    case 'available':
      return <CheckCircle2 className="text-text-secondary size-3.5 shrink-0" aria-hidden="true" />;
    case 'quota_exhausted':
      return <AlertTriangle className="text-text-warning size-3.5 shrink-0" aria-hidden="true" />;
    case 'cooling_down':
      return <Clock3 className="text-text-warning size-3.5 shrink-0" aria-hidden="true" />;
    case 'unconfigured':
      return <KeyRound className="text-text-secondary size-3.5 shrink-0" aria-hidden="true" />;
    case 'unverified':
      return <HelpCircle className="text-text-secondary size-3.5 shrink-0" aria-hidden="true" />;
    case 'unavailable':
      return <CircleMinus className="text-text-secondary size-3.5 shrink-0" aria-hidden="true" />;
    default:
      return null;
  }
}

function ProviderRow({
  label,
  detail,
  stateLabel,
  state,
  requests,
}: {
  label: string;
  detail?: string;
  stateLabel: string;
  state: WorkProviderAvailability | WorkPrimaryAvailability;
  requests?: string;
}) {
  return (
    <div className="flex items-start gap-2 px-0 py-1.5">
      <span className="mt-0.5">
        <StateIcon state={state} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-text-primary block truncate text-xs" title={label}>
          {label}
        </span>
        {detail != null && detail !== '' && (
          <span className="text-text-secondary block truncate font-mono text-xs" title={detail}>
            {detail}
          </span>
        )}
        {requests != null && <span className="text-text-secondary block text-xs">{requests}</span>}
      </span>
      <span
        className={cn(
          'shrink-0 text-xs',
          state === 'quota_exhausted' || state === 'cooling_down'
            ? 'text-text-warning'
            : 'text-text-secondary',
        )}
      >
        {stateLabel}
      </span>
    </div>
  );
}

/**
 * Provider status rows shared by the Work model menu and the routing badge.
 *
 * Everything shown comes from the authenticated `/api/work/routing` snapshot:
 * the server names the catalogue, the active model and the remaining budget.
 * No credential value is requested or rendered, and an unknown state stays
 * "unavailable" rather than being guessed.
 */
export function WorkProviderStatusDetails({
  routing,
  testId = 'work-provider-status',
}: {
  routing: TWorkRoutingSnapshot;
  testId?: string;
}) {
  const localize = useLocalize();
  const primary = workPrimaryAvailability(routing);

  return (
    <div data-testid={testId} role="group" aria-label={localize('com_work_provider_status')}>
      <div className="flex items-baseline justify-between gap-2 pb-1">
        <span className="text-text-secondary text-xs font-semibold">
          {localize('com_work_provider_status')}
        </span>
        <span className="text-text-secondary text-xs">{localize('com_work_provider_no_paid')}</span>
      </div>
      {!routing.enabled && (
        <p className="text-text-secondary py-1 text-xs">
          {localize('com_work_provider_not_enabled')}
        </p>
      )}
      {routing.enabled && (
        <>
          <ProviderRow
            label={routing.primary.label}
            detail={localize('com_work_provider_primary')}
            state={primary}
            stateLabel={primaryLabel(primary, localize)}
          />
          {routing.endpoints.map((endpoint: TWorkRoutingEndpoint) => {
            const state = workProviderAvailability(endpoint);
            return (
              <ProviderRow
                key={endpoint.id}
                label={endpoint.label}
                detail={endpoint.modelId}
                state={state}
                stateLabel={availabilityLabel(state, localize)}
                requests={localize('com_work_provider_requests_left', {
                  0: String(workProviderRequestsRemaining(endpoint)),
                  1: String(endpoint.quota.requestsLimit),
                })}
              />
            );
          })}
          {routing.activeModel == null && (
            <p role="status" className="text-text-warning pt-1 text-xs">
              {localize('com_work_routing_exhausted')}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** Provider status inside the Work model menu. */
export function WorkProviderStatus() {
  const localize = useLocalize();
  const { data, isError, isLoading } = useQuery({
    queryKey: [QueryKeys.workRouting],
    queryFn: () => dataService.getWorkRouting(),
    retry: false,
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <p role="status" className="text-text-secondary px-2.5 py-2 text-xs">
        {localize('com_work_provider_loading')}
      </p>
    );
  }
  if (isError) {
    return (
      <p role="alert" className="text-text-secondary px-2.5 py-2 text-xs">
        {localize('com_work_provider_error')}
      </p>
    );
  }

  const routing = data?.routing;
  if (!routing) {
    return null;
  }

  return (
    <div className="border-border-menu mt-1 border-t px-2.5 pt-2 pb-1">
      <WorkProviderStatusDetails routing={routing} />
    </div>
  );
}
