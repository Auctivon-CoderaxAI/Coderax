import { useQuery } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'coderax-data-provider';
import { useLocalize } from '~/hooks';

/**
 * The provider and model a new Work turn actually uses.
 *
 * Rendered only when the deployment opted into zero-cost routing and something
 * is routable, so the existing composer is untouched everywhere else. The
 * preferred model's unavailability is named next to the active route instead of
 * being hidden, because "DeepSeek-R1" on a distilled model would be a lie.
 */
export function WorkRoutingBadge() {
  const localize = useLocalize();
  const { data } = useQuery({
    queryKey: [QueryKeys.workRouting],
    queryFn: () => dataService.getWorkRouting(),
    retry: false,
    staleTime: 30_000,
  });

  const routing = data?.routing;
  if (!routing?.enabled || !routing.activeModel) {
    return null;
  }

  const { provider, modelId, label } = routing.activeModel;

  return (
    <div
      data-testid="work-routing-badge"
      className="text-text-secondary flex min-w-0 items-center gap-2 text-xs"
    >
      <span className="truncate" title={`${provider} · ${modelId}`}>
        {localize('com_work_routing_active', { 0: label, 1: provider })}
      </span>
      {!routing.primary.available && (
        <span className="truncate">
          {localize('com_work_routing_primary_unavailable', { 0: routing.primary.label })}
        </span>
      )}
    </div>
  );
}
