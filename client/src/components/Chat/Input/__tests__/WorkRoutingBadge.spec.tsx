import { dataService } from 'coderax-data-provider';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TWorkRoutingResponse } from 'coderax-data-provider';
import { WorkRoutingBadge } from '../WorkRoutingBadge';

jest.mock('coderax-data-provider', () => ({
  ...jest.requireActual('coderax-data-provider'),
  dataService: { getWorkRouting: jest.fn() },
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, string>) =>
    ({
      com_work_routing_active: `Routed to ${values?.[0]} via ${values?.[1]}`,
      com_work_routing_primary_unavailable: `${values?.[0]} is unavailable on a free endpoint`,
      com_work_routing_primary_unconfigured: `${values?.[0]} has no server credential`,
      com_work_routing_requests_left: `${values?.[0]} requests left in today's free budget`,
      com_work_routing_exhausted: 'Free capacity is exhausted; no paid model is used.',
      com_work_provider_status: 'Provider status',
      com_work_provider_no_paid: 'No paid fallback',
      com_work_provider_primary: 'Preferred model',
      com_work_provider_available: 'Available',
      com_work_provider_quota_exhausted: 'Quota exhausted',
      com_work_provider_cooling_down: 'Cooling down',
      com_work_provider_unavailable: 'Unavailable',
      com_work_provider_unconfigured: 'No server credential',
      com_work_provider_unverified: 'No verified free endpoint',
      com_work_provider_requests_left: `${values?.[0]} of ${values?.[1]} requests left`,
    })[key] ?? key,
}));

function snapshot(overrides: Partial<TWorkRoutingResponse['routing']> = {}): TWorkRoutingResponse {
  return {
    routing: {
      enabled: true,
      primary: {
        available: false,
        label: 'DeepSeek-R1 671B',
        modelIds: ['deepseek/deepseek-r1-0528'],
        reason: 'no_verified_free_endpoint',
        checkedAt: '2026-11-08',
        evidence: [],
      },
      activeModel: {
        provider: 'groq',
        modelId: 'openai/gpt-oss-120b',
        label: 'OpenAI GPT-OSS 120B on Groq',
      },
      endpoints: [],
      paidRoutesEnabled: false,
      ...overrides,
    },
  };
}

function endpoint() {
  return {
    id: 'groq-gpt-oss-120b',
    provider: 'groq',
    modelId: 'openai/gpt-oss-120b',
    label: 'OpenAI GPT-OSS 120B on Groq',
    kind: 'fallback' as const,
    freeEligible: true,
    credentialPresent: true,
    healthy: true,
    available: true,
    rejectionReason: null,
    cooldownUntil: null,
    tools: false,
    quota: {
      requestsUsed: 10,
      requestsLimit: 200,
      tokensUsed: 1_000,
      tokensLimit: 400_000,
      resetAt: 0,
    },
  };
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WorkRoutingBadge />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(dataService.getWorkRouting).mockResolvedValue(snapshot());
});
afterEach(() => jest.restoreAllMocks());

it('names the provider and model a turn would use, and the missing preferred model', async () => {
  setup();
  const badge = await screen.findByTestId('work-routing-badge');
  expect(badge).toHaveTextContent('Routed to OpenAI GPT-OSS 120B on Groq via groq');
  expect(badge).toHaveTextContent('DeepSeek-R1 671B is unavailable on a free endpoint');
});

it('does not claim the preferred model is missing when it is serving', async () => {
  jest.mocked(dataService.getWorkRouting).mockResolvedValue(
    snapshot({
      primary: {
        available: true,
        label: 'DeepSeek-R1 671B',
        modelIds: ['deepseek/deepseek-r1-0528'],
        checkedAt: '2026-11-08',
        evidence: [],
      },
      activeModel: {
        provider: 'openrouter',
        modelId: 'deepseek/deepseek-r1-0528',
        label: 'DeepSeek-R1 671B',
      },
    }),
  );
  setup();
  const badge = await screen.findByTestId('work-routing-badge');
  expect(badge).toHaveTextContent('Routed to DeepSeek-R1 671B via openrouter');
  expect(badge).not.toHaveTextContent('unavailable');
});

it('shows the remaining free budget from the active endpoint row', async () => {
  jest.mocked(dataService.getWorkRouting).mockResolvedValue(snapshot({ endpoints: [endpoint()] }));
  setup();
  const badge = await screen.findByTestId('work-routing-badge');
  expect(badge).toHaveTextContent("190 requests left in today's free budget");
});

it('opens the provider status popover from the same routing snapshot', async () => {
  jest.mocked(dataService.getWorkRouting).mockResolvedValue(snapshot({ endpoints: [endpoint()] }));
  setup();

  const badge = await screen.findByTestId('work-routing-badge');
  expect(badge).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByTestId('work-provider-status-popover')).not.toBeInTheDocument();

  fireEvent.click(badge);

  const popover = await screen.findByTestId('work-provider-status-popover');
  expect(badge).toHaveAttribute('aria-expanded', 'true');
  expect(popover).toHaveTextContent('Provider status');
  expect(popover).toHaveTextContent('No paid fallback');
  expect(popover).toHaveTextContent('Preferred model');
  expect(popover).toHaveTextContent('DeepSeek-R1 671B');
  expect(popover).toHaveTextContent('No verified free endpoint');
  expect(popover).toHaveTextContent('OpenAI GPT-OSS 120B on Groq');
  expect(popover).toHaveTextContent('openai/gpt-oss-120b');
  expect(popover).toHaveTextContent('Available');
  expect(popover).toHaveTextContent('190 of 200 requests left');
  expect(dataService.getWorkRouting).toHaveBeenCalledTimes(1);
});

it('reports exhausted free capacity instead of implying a paid fallback', async () => {
  jest.mocked(dataService.getWorkRouting).mockResolvedValue(snapshot({ activeModel: null }));
  setup();
  const badge = await screen.findByTestId('work-routing-badge');
  expect(badge).toHaveTextContent('Free capacity is exhausted; no paid model is used.');
  expect(badge).not.toHaveTextContent('Routed to');

  fireEvent.click(badge);

  const popover = await screen.findByTestId('work-provider-status-popover');
  expect(popover).toHaveTextContent('Provider status');
  expect(popover).toHaveTextContent('Free capacity is exhausted; no paid model is used.');
  expect(popover).not.toHaveTextContent('Routed to');
});

it('renders nothing when the deployment has not enabled routing', async () => {
  jest
    .mocked(dataService.getWorkRouting)
    .mockResolvedValue(snapshot({ enabled: false, activeModel: null }));
  setup();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.queryByTestId('work-routing-badge')).not.toBeInTheDocument();
});
