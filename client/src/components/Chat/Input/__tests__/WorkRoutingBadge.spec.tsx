import { dataService } from 'coderax-data-provider';
import type { TWorkRoutingResponse } from 'coderax-data-provider';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WorkRoutingBadge />
    </QueryClientProvider>,
  );
}

beforeEach(() => jest.mocked(dataService.getWorkRouting).mockResolvedValue(snapshot()));
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

it('renders nothing when the deployment has not enabled routing', async () => {
  jest.mocked(dataService.getWorkRouting).mockResolvedValue(
    snapshot({ enabled: false, activeModel: null }),
  );
  setup();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.queryByTestId('work-routing-badge')).not.toBeInTheDocument();
});
