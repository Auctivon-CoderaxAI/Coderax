import { EModelEndpoint } from 'coderax-data-provider';
import type { TWorkModel } from 'coderax-data-provider';
import { resolveWorkSelection, sanitizeWorkSelection, toWorkOptions } from '../workSelection';

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
