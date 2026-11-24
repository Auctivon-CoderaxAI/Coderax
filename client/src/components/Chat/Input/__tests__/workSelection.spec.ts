import { EModelEndpoint } from 'coderax-data-provider';
import type { TWorkModel } from 'coderax-data-provider';
import {
  getWorkModelKey,
  resolveWorkSelection,
  sanitizeWorkSelection,
  selectWorkAgentIdentity,
  selectWorkMode,
  toWorkOptions,
} from '../workSelection';

const target = { id: 'quick:free', label: 'Quick', provider: 'openrouter' };
const models: TWorkModel[] = [
  { id: 'auto', label: 'Automatic', auto: true, target },
  { id: 'quick:free', label: 'Quick', provider: 'openrouter' },
  { id: 'strong:free', label: 'Strong', provider: 'openrouter' },
];
function nativePreset(resolved: ReturnType<typeof resolveWorkSelection>) {
  if (!resolved || resolved.workAgent !== 'coderax') {
    throw new Error('expected a native Work selection');
  }
  return resolved.preset;
}

const routingModes: TWorkModel[] = [
  { id: 'auto', label: 'Automatic', auto: true, routingMode: 'auto', target },
  {
    id: 'fast',
    label: 'Fast',
    auto: true,
    routingMode: 'fast',
    target,
  },
  {
    id: 'complex',
    label: 'Complex',
    auto: true,
    routingMode: 'complex',
    target: { id: 'strong:free', label: 'Strong', provider: 'openrouter' },
  },
];

describe('Work routing selection', () => {
  it('keeps routing sentinels out of the concrete model list', () => {
    const options = toWorkOptions(models, [], routingModes);
    expect(options.routing?.map((option) => option.routingMode)).toEqual([
      'auto',
      'fast',
      'complex',
    ]);
    expect(options.models.map((model) => model.id)).toEqual(['quick:free', 'strong:free']);
  });

  it('keeps the routing sentinel on the wire and names its concrete target', () => {
    const options = toWorkOptions(models, [], routingModes);
    const resolved = resolveWorkSelection({ agentId: 'auto', modelKey: 'fast' }, options);
    expect(resolved?.model).toMatchObject({ id: 'quick:free', provider: 'openrouter' });
    expect(resolved?.automatic).toBe(true);
    expect(nativePreset(resolved)).toEqual({
      endpoint: 'openrouter' as EModelEndpoint,
      model: 'fast',
    });
  });

  it('falls back to the legacy automatic option when the server sends no modes', () => {
    const options = toWorkOptions(models, []);
    expect(options.routing?.map((option) => option.routingMode)).toEqual(['auto']);
    expect(
      nativePreset(resolveWorkSelection({ agentId: 'auto', modelKey: 'auto' }, options)),
    ).toEqual({
      endpoint: 'openrouter' as EModelEndpoint,
      model: 'auto',
    });
  });

  it('preserves a still-offered sentinel and drops an unknown one', () => {
    const options = toWorkOptions(models, [], routingModes);
    expect(sanitizeWorkSelection({ agentId: 'auto', modelKey: 'complex' }, options).modelKey).toBe(
      'complex',
    );
    expect(sanitizeWorkSelection({ agentId: 'auto', modelKey: 'gone' }, options).modelKey).toBe(
      'auto',
    );
  });

  it('refuses a mode whose target is no longer offered', () => {
    const options = toWorkOptions(models, [], routingModes);
    const withoutTarget = { ...options, models: [] };
    expect(resolveWorkSelection({ agentId: 'auto', modelKey: 'fast' }, withoutTarget)).toBeNull();
  });
});

describe('Work identity and mode transitions', () => {
  it.each(['opencode', 'freebuff'] as const)(
    'restores a remembered native model after %s',
    (identity) => {
      const options = toWorkOptions(models, []);
      const native = { agentId: 'auto', modelKey: getWorkModelKey(models[2]) };
      const external = sanitizeWorkSelection(
        selectWorkAgentIdentity(native, identity, options),
        options,
      );
      expect(
        nativePreset(
          resolveWorkSelection(selectWorkAgentIdentity(external, 'coderax', options), options),
        ).model,
      ).toBe('strong:free');
    },
  );

  it.each([true, false])(
    'switches back to a runnable native model (automatic offered: %s)',
    (automatic) => {
      const options = toWorkOptions(automatic ? models : models.slice(1), []);
      const external = sanitizeWorkSelection(
        { workAgent: 'opencode', modelKey: 'no-longer-offered' },
        options,
      );
      const next = selectWorkAgentIdentity(external, 'coderax', options);
      expect(nativePreset(resolveWorkSelection(next, options)).model).toBe(
        automatic ? 'auto' : 'quick:free',
      );
    },
  );

  it('runs the built-in Plan mode instead of the previously selected saved agent', () => {
    const options = toWorkOptions(models, []);
    const saved = {
      agentId: 'saved',
      modelKey: getWorkModelKey(models[1]),
      workAgent: 'coderax' as const,
    };
    expect(resolveWorkSelection(selectWorkMode(saved, 'plan'), options)).toMatchObject({
      agent: null,
      mode: 'plan',
      promptPrefix: expect.stringContaining('Do not edit files'),
    });
  });
});
