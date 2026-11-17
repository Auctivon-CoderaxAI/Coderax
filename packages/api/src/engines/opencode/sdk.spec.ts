jest.mock('@opencode-ai/sdk', () => ({ createOpencodeClient: jest.fn() }), { virtual: true });

import { loadOpenCodeSdk } from './sdk';

describe('OpenCode SDK transport', () => {
  it('uses the root client nested path, body and query shape', async () => {
    const stream = { async *[Symbol.asyncIterator]() {} };
    const create = jest.fn(async () => ({ data: { id: 'ses_1' } }));
    const promptAsync = jest.fn(async () => ({}));
    const abort = jest.fn(async () => ({}));
    const subscribe = jest.fn(async () => ({ stream }));
    const createOpencodeClient = jest.requireMock('@opencode-ai/sdk')
      .createOpencodeClient as jest.Mock;
    createOpencodeClient.mockReturnValue({
      session: { create, promptAsync, abort },
      event: { subscribe },
    });

    const loaded = loadOpenCodeSdk({
      baseURL: 'http://127.0.0.1:4096',
      directory: '/srv/coderax/private',
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    const { transport } = loaded.value;

    await expect(
      transport.createSession({ directory: '/srv/coderax/private', title: 'conversation-1' }),
    ).resolves.toEqual({ id: 'ses_1' });
    expect(create).toHaveBeenCalledWith({
      body: { title: 'conversation-1' },
      query: { directory: '/srv/coderax/private' },
    });

    await transport.prompt({
      sessionId: 'ses_1',
      directory: '/srv/coderax/private',
      text: 'Fix it',
      model: { providerId: 'anthropic', modelId: 'claude-sonnet-5-5' },
    });
    expect(promptAsync).toHaveBeenCalledWith({
      path: { id: 'ses_1' },
      query: { directory: '/srv/coderax/private' },
      body: {
        model: { providerID: 'anthropic', modelID: 'claude-sonnet-5-5' },
        parts: [{ type: 'text', text: 'Fix it' }],
      },
    });

    const controller = new AbortController();
    await transport.subscribe({
      directory: '/srv/coderax/private',
      sessionId: 'ses_1',
      signal: controller.signal,
    });
    expect(subscribe).toHaveBeenCalledWith({
      query: { directory: '/srv/coderax/private' },
      signal: controller.signal,
    });

    await transport.abort({ sessionId: 'ses_1', directory: '/srv/coderax/private' });
    expect(abort).toHaveBeenCalledWith({
      path: { id: 'ses_1' },
      query: { directory: '/srv/coderax/private' },
    });
  });
});
