import type { GatewayConfig } from './config';
import { ExecutionEvent, WorkSubmitRequest, enginePath } from './contracts';
import { GatewayConfigurationError, resolveGatewayConfig } from './config';
import { createTransportSelector } from './transport';
import { fromEngineProblem } from './errors';

const base: GatewayConfig = {
  enabled: true,
  baseUrl: 'https://engine.example.test',
  tokenEnv: 'WORKFLOW_ENGINE_TOKEN',
  contractVersion: '1.0.0',
  timeoutMs: 30_000,
  healthTtlMs: 15_000,
  authority: 'native',
  engineConversations: [],
  nativeConversations: [],
};

describe('transport selection', () => {
  it('keeps the in-repository engine authoritative by default', () => {
    const selector = createTransportSelector(base);

    expect(selector.authorityForConversation('conv_1')).toBe('native');
    expect(selector.authorityForNewConversation()).toBe('native');
    expect(selector.engineReachable()).toBe(false);
  });

  it('moves only explicitly listed conversations to the external engine', () => {
    const selector = createTransportSelector({
      ...base,
      engineConversations: ['conv_engine'],
    });

    expect(selector.authorityForConversation('conv_engine')).toBe('engine');
    expect(selector.authorityForConversation('conv_other')).toBe('native');
    expect(selector.authorityForNewConversation()).toBe('native');
    expect(selector.engineReachable()).toBe(true);
  });

  it('lets a rollback override the global authority without touching data', () => {
    const selector = createTransportSelector({
      ...base,
      authority: 'engine',
      nativeConversations: ['conv_rollback'],
    });

    expect(selector.authorityForConversation('conv_rollback')).toBe('native');
    expect(selector.authorityForConversation('conv_anywhere_else')).toBe('engine');
    expect(selector.authorityForNewConversation()).toBe('engine');
    expect(selector.describe()).toEqual({
      mode: 'engine',
      engineConversations: 0,
      nativeConversations: 1,
      reversible: true,
    });
  });
});

describe('gateway configuration', () => {
  it('reproduces the safe default: disabled and native', () => {
    expect(resolveGatewayConfig(undefined)).toMatchObject({
      enabled: false,
      authority: 'native',
      tokenEnv: 'WORKFLOW_ENGINE_TOKEN',
      contractVersion: '1.0.0',
    });
  });

  it('refuses a conversation claimed by both transports', () => {
    expect(() =>
      resolveGatewayConfig({
        enabled: true,
        engineConversations: ['conv_1'],
        nativeConversations: ['conv_1'],
      }),
    ).toThrow(GatewayConfigurationError);
  });

  it('refuses an unsupported contract version', () => {
    expect(() => resolveGatewayConfig({ contractVersion: '2.0.0' })).toThrow(
      GatewayConfigurationError,
    );
  });

  it('refuses an unknown configuration field rather than silently ignoring a control', () => {
    expect(() => resolveGatewayConfig({ enabled: true, authority: 'both' })).toThrow(
      GatewayConfigurationError,
    );
    expect(() => resolveGatewayConfig({ enabled: true, unknownToggle: true })).toThrow(
      GatewayConfigurationError,
    );
  });

  it('refuses a non-http engine origin', () => {
    expect(() => resolveGatewayConfig({ baseUrl: 'file:///etc/passwd' })).toThrow(
      GatewayConfigurationError,
    );
  });
});

describe('contract mirroring', () => {
  it('rejects a work request the engine contract does not allow', () => {
    expect(WorkSubmitRequest.safeParse({ objective: 'x', surprise: true }).success).toBe(false);
    expect(WorkSubmitRequest.safeParse({ objective: 'x' }).success).toBe(true);
  });

  it('rejects an unknown execution event type instead of passing it on', () => {
    const event = {
      v: 1,
      eventId: 'evt_1',
      taskId: 'task_1',
      seq: 1,
      at: '2026-11-26T12:00:00.000Z',
      agent: 'coderax',
      generation: 1,
      type: 'task.teleported',
    };
    expect(ExecutionEvent.safeParse(event).success).toBe(false);
    expect(ExecutionEvent.safeParse({ ...event, type: 'task.queued' }).success).toBe(true);
  });

  it('encodes path parameters and refuses a missing one', () => {
    expect(enginePath('getTask', { taskId: 'a/b' })).toBe('/v1/work/a%2Fb');
    expect(() => enginePath('getTask', {})).toThrow();
  });

  it('drops upstream problem text when mapping a failure', () => {
    const mapped = fromEngineProblem({
      code: 'permission_required',
      status: 409,
      retryable: false,
    });

    expect(mapped).toEqual({
      code: 'permission_required',
      status: 409,
      title: 'permission required',
      retryable: false,
    });
  });
});
