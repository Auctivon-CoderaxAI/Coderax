import { EModelEndpoint } from 'coderax-data-provider';
import type { TEndpointsConfig } from 'coderax-data-provider';
import getDefaultEndpoint from '../getDefaultEndpoint';
import { getLocalStorageItems } from '../localStorage';

jest.mock('../localStorage', () => ({ getLocalStorageItems: jest.fn() }));

const mockedGetLocalStorageItems = jest.mocked(getLocalStorageItems);

describe('getDefaultEndpoint', () => {
  it('ignores a previously selected endpoint after all models are removed', () => {
    mockedGetLocalStorageItems.mockReturnValue({
      lastConversationSetup: { endpoint: 'ollama' as EModelEndpoint },
      lastSelectedModel: {},
      lastSelectedTools: [],
    });

    expect(
      getDefaultEndpoint({
        convoSetup: { endpoint: 'ollama' as EModelEndpoint },
        endpointsConfig: {} as TEndpointsConfig,
      }),
    ).toBeUndefined();
  });

  it('uses an available endpoint when the stored choice was removed', () => {
    mockedGetLocalStorageItems.mockReturnValue({
      lastConversationSetup: { endpoint: 'ollama' as EModelEndpoint },
      lastSelectedModel: {},
      lastSelectedTools: [],
    });
    const endpointsConfig = {
      available: { type: EModelEndpoint.custom, order: 0 },
    } as TEndpointsConfig;

    expect(getDefaultEndpoint({ convoSetup: {}, endpointsConfig })).toBe('available');
  });
});
