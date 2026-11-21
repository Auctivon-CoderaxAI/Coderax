import type { EngineWorkChatConfig } from './types';
import { isEngineWorkChatPath, isOwnerEngineWorkChat } from './gating';

const enabledConfig = (workChat: Record<string, unknown> = {}): EngineWorkChatConfig =>
  ({
    engines: {
      workChat: { enabled: true, engine: 'opencode', ...workChat },
      opencode: { enabled: true },
    },
  }) as unknown as EngineWorkChatConfig;

const owner = { role: 'ADMIN' };

describe('isOwnerEngineWorkChat', () => {
  it('admits the owner with no agent selection', () => {
    expect(isOwnerEngineWorkChat({ config: enabledConfig(), user: owner, body: {} })).toBe(true);
    expect(isOwnerEngineWorkChat({ config: enabledConfig(), user: owner, body: null })).toBe(true);
    expect(isOwnerEngineWorkChat({ config: enabledConfig(), user: owner })).toBe(true);
  });

  it('fails closed when the deployment flag is off or absent', () => {
    expect(
      isOwnerEngineWorkChat({
        config: enabledConfig({ enabled: false }),
        user: owner,
        body: {},
      }),
    ).toBe(false);
    expect(
      isOwnerEngineWorkChat({
        config: { engines: {} } as EngineWorkChatConfig,
        user: owner,
        body: {},
      }),
    ).toBe(false);
    expect(isOwnerEngineWorkChat({ config: null, user: owner, body: {} })).toBe(false);
    expect(isOwnerEngineWorkChat({ config: undefined, user: owner, body: {} })).toBe(false);
  });

  it('is case-sensitive and requires the admin role exactly', () => {
    expect(
      isOwnerEngineWorkChat({ config: enabledConfig(), user: { role: 'USER' }, body: {} }),
    ).toBe(false);
    expect(
      isOwnerEngineWorkChat({ config: enabledConfig(), user: { role: 'admin' }, body: {} }),
    ).toBe(false);
    expect(isOwnerEngineWorkChat({ config: enabledConfig(), user: {}, body: {} })).toBe(false);
    expect(isOwnerEngineWorkChat({ config: enabledConfig(), user: null, body: {} })).toBe(false);
  });

  it.each(['agent_id', 'agentId', 'ephemeralAgent', 'spec'])(
    'leaves a turn naming %s on the native runner',
    (field) => {
      expect(
        isOwnerEngineWorkChat({ config: enabledConfig(), user: owner, body: { [field]: 'value' } }),
      ).toBe(false);
    },
  );

  it('treats an explicit null agent field as no selection', () => {
    expect(
      isOwnerEngineWorkChat({
        config: enabledConfig(),
        user: owner,
        body: { agent_id: null, agentId: null, ephemeralAgent: null, spec: null },
      }),
    ).toBe(true);
  });
});

describe('isEngineWorkChatPath', () => {
  it.each(['/chat', '/chat/', '/chat/agents'])('claims %s', (path) => {
    expect(isEngineWorkChatPath(path)).toBe(true);
  });

  it.each(['/chat/agents/preview', '/chats', '/api/work/chat', '/chat//', ''])(
    'leaves %s to the native router',
    (path) => {
      expect(isEngineWorkChatPath(path)).toBe(false);
    },
  );
});
