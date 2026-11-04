import { createConfiguredDefaultResolver } from './configuredDefault';

describe('createConfiguredDefaultResolver', () => {
  it('loads the app config when the request has none and leaves it for the agents chain', async () => {
    let loads = 0;
    const resolver = createConfiguredDefaultResolver(
      async () => {
        loads += 1;
        return { modelSpecs: { list: [{ default: true, preset: { model: 'llama3:latest' } }] } };
      },
      (config) => config?.modelSpecs.list[0]?.preset.model ?? null,
    );
    const req = { user: { id: 'user-1' } };

    await expect(resolver(req)).resolves.toBe('llama3:latest');
    expect(loads).toBe(1);
    expect(req).toMatchObject({
      config: { modelSpecs: { list: [{ default: true, preset: { model: 'llama3:latest' } }] } },
    });
  });

  it('reuses a loaded config instead of reading it again', async () => {
    let loads = 0;
    const resolver = createConfiguredDefaultResolver(
      async () => {
        loads += 1;
        return { modelSpecs: { list: [{ default: true, preset: { model: 'qwen2.5' } }] } };
      },
      (config) => config?.modelSpecs.list[0]?.preset.model ?? null,
    );
    const req = {};

    await expect(resolver(req)).resolves.toBe('qwen2.5');
    await expect(resolver(req)).resolves.toBe('qwen2.5');
    expect(loads).toBe(1);
  });

  it('does not load a config that is already attached', async () => {
    let loads = 0;
    const resolver = createConfiguredDefaultResolver(
      async () => {
        loads += 1;
        return null;
      },
      () => 'from-config',
    );

    await expect(resolver({ config: {} })).resolves.toBe('from-config');
    expect(loads).toBe(0);
  });

  it('returns no default when the config read fails', async () => {
    const resolver = createConfiguredDefaultResolver(
      async () => {
        throw new Error('config unavailable');
      },
      () => {
        throw new Error('the resolver must not run without a config');
      },
    );

    await expect(resolver({ user: { id: 'user-1' } })).resolves.toBeNull();
  });

  it('rejects missing dependency functions', () => {
    expect(() => createConfiguredDefaultResolver(undefined as never, () => null)).toThrow(
      /requires load and resolve functions/,
    );
    expect(() => createConfiguredDefaultResolver(async () => null, undefined as never)).toThrow(
      /requires load and resolve functions/,
    );
  });
});
