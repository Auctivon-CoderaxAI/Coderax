import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ProviderCatalogResponse } from 'coderax-data-provider';
import ProviderCatalog, { buildCatalogRows } from '../ProviderCatalog';
import { CustomMenu } from '../CustomMenu';

jest.mock('coderax-data-provider/react-query', () => ({
  useGetProviderCatalogQuery: jest.fn(),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, string>) => {
    if (values) {
      return Object.entries(values).reduce(
        (text, [name, value]) => text.replace(`{${name}}`, value),
        key,
      );
    }
    return key;
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useGetProviderCatalogQuery } = require('coderax-data-provider/react-query');

const catalog: ProviderCatalogResponse = {
  generatedAt: '2026-11-28T00:00:00.000Z',
  counts: { providers: 2, discoveredProviders: 2, models: 3, availableModels: 1, workModels: 2 },
  providers: [
    {
      provider: 'openrouter',
      label: 'OpenRouter',
      credential: { configured: true, env: 'OPENROUTER_KEY', legacy: false },
      authentication: 'authenticated',
      modelsDiscovered: 440,
      modelsEligible: 13,
      blockedReasons: { nonzero_price: 427 },
    },
    {
      provider: 'apinex',
      label: 'APInex',
      credential: { configured: true, env: 'APINEX_API_KEY', legacy: false },
      authentication: 'rejected',
      modelsDiscovered: 0,
      modelsEligible: 0,
      blockedReasons: { credential_rejected: 1 },
    },
  ],
  models: [
    {
      provider: 'openrouter',
      providerLabel: 'OpenRouter',
      id: 'deepseek/deepseek-r1:free',
      label: 'DeepSeek R1 (free)',
      contextTokens: 163840,
      pricing: { promptPerToken: 0, completionPerToken: 0, free: true, basis: 'per-model' },
      capabilities: { streaming: true, reasoning: true, tools: true, structuredOutputs: false },
      available: true,
      reason: 'available',
      chat: true,
      work: true,
    },
    {
      provider: 'openrouter',
      providerLabel: 'OpenRouter',
      id: 'openai/gpt-5',
      label: 'GPT-5',
      contextTokens: 400000,
      pricing: {
        promptPerToken: 1.25e-6,
        completionPerToken: 1e-5,
        free: false,
        basis: 'per-model',
      },
      capabilities: { streaming: true, reasoning: true, tools: true, structuredOutputs: true },
      available: false,
      reason: 'nonzero_price',
      chat: true,
      work: true,
    },
    {
      provider: 'apinex',
      providerLabel: 'APInex',
      id: 'apinex-chat',
      label: 'APInex Chat',
      contextTokens: null,
      pricing: { promptPerToken: null, completionPerToken: null, free: null, basis: 'unknown' },
      capabilities: { streaming: null, reasoning: null, tools: null, structuredOutputs: null },
      available: false,
      reason: 'credential_rejected',
      chat: false,
      work: false,
    },
  ],
};

describe('buildCatalogRows', () => {
  it('groups each provider with its own models', () => {
    const rows = buildCatalogRows(catalog, 'all', '');
    expect(rows.filter((row) => row.kind === 'provider')).toHaveLength(2);
    expect(rows.filter((row) => row.kind === 'model')).toHaveLength(3);
    expect(rows[0]).toMatchObject({ kind: 'provider', status: { provider: 'openrouter' } });
  });

  it('drops providers with no model matching the filter', () => {
    const rows = buildCatalogRows(catalog, 'free', '');
    expect(rows.filter((row) => row.kind === 'provider')).toHaveLength(1);
    expect(rows.filter((row) => row.kind === 'model')).toHaveLength(1);
  });

  it('searches by id and keeps the provider header', () => {
    const rows = buildCatalogRows(catalog, 'all', 'gpt-5');
    expect(rows).toHaveLength(2);
    expect(rows[0].kind).toBe('provider');
    expect(rows[1]).toMatchObject({ kind: 'model', model: { id: 'openai/gpt-5' } });
  });

  it('applies capability filters', () => {
    expect(buildCatalogRows(catalog, 'work', '').filter((r) => r.kind === 'model')).toHaveLength(2);
    expect(
      buildCatalogRows(catalog, 'reasoning', '').filter((r) => r.kind === 'model'),
    ).toHaveLength(2);
  });
});

describe('ProviderCatalog', () => {
  it('offers retry after an initial failure and keeps cached data after a refresh failure', () => {
    const refetch = jest.fn();
    (useGetProviderCatalogQuery as jest.Mock).mockReturnValue({ isError: true, refetch });
    const { rerender } = render(<ProviderCatalog onSelect={jest.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('com_providers_load_error');
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);

    (useGetProviderCatalogQuery as jest.Mock).mockReturnValue({ isError: true, data: catalog });
    rerender(<ProviderCatalog onSelect={jest.fn()} />);
    expect(screen.getByTestId('provider-catalog')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('registers measured options and only selects available Chat models', async () => {
    jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(260);
    const [chat] = catalog.models;
    const catalogWithNonChat = {
      ...catalog,
      models: [
        ...catalog.models,
        { ...chat, chat: false, work: false, id: 'example/image:free', label: 'Image model' },
      ],
    };
    (useGetProviderCatalogQuery as jest.Mock).mockReturnValue({ data: catalogWithNonChat });
    const onSelect = jest.fn();
    render(
      <CustomMenu
        defaultOpen
        label="Catalog"
        onSearch={jest.fn()}
        combobox={<input aria-label="Search models" />}
      >
        <ProviderCatalog onSelect={onSelect} />
      </CustomMenu>,
    );

    const listbox = within(await screen.findByRole('listbox'));
    const paid = listbox.getByRole('option', { name: /GPT-5/ });
    const nonChat = listbox.getByRole('option', { name: /Image model/ });
    const free = listbox.getByRole('option', { name: /DeepSeek R1/ });
    expect(free.closest('[data-index]')).toHaveAttribute('data-index', '1');
    expect(paid).toHaveTextContent('com_providers_reason_nonzero_price');
    for (const option of [paid, nonChat]) {
      expect(option).toHaveAttribute('aria-disabled', 'true');
      fireEvent.click(option);
    }
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(free);
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'openrouter', providerLabel: 'OpenRouter', id: chat.id }),
    );
  });

  beforeEach(() => {
    (useGetProviderCatalogQuery as jest.Mock).mockReturnValue({ data: catalog, isLoading: false });
  });

  it('renders the catalog with every filter control', () => {
    render(<ProviderCatalog onSelect={jest.fn()} />);
    expect(screen.getByTestId('provider-catalog')).toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toHaveAttribute('aria-label', 'com_providers_search');
    expect(screen.getByText('com_providers_filter_free')).toBeInTheDocument();
    expect(screen.getByLabelText('com_providers_filters')).toBeInTheDocument();
  });

  it('reports the loading state before the catalog resolves', () => {
    (useGetProviderCatalogQuery as jest.Mock).mockReturnValue({ data: undefined, isLoading: true });
    render(<ProviderCatalog onSelect={jest.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('com_providers_loading');
  });
});
