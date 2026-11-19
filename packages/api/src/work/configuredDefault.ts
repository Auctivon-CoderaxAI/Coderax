/**
 * Resolve the deployment's configured default model for a Work request.
 *
 * `configMiddleware` normally attaches `req.config`, but Work's gate runs
 * before the agents chain that would attach it, so an absent config is loaded
 * here and left on the request for that chain to reuse. A config read failure
 * is reported as "no default" (null) rather than thrown: the caller already
 * turns that into an actionable Work error, and an explicit model choice must
 * still be able to run.
 */
export type ConfiguredDefaultRequest<TConfig> = {
  config?: TConfig | null;
  [key: string]: unknown;
};

export type ConfiguredDefaultModel = {
  id: string;
  provider?: string;
};

type ConfiguredDefaultSpec = {
  default?: unknown;
  softDefault?: unknown;
  preset?: { model?: unknown; endpoint?: unknown };
};

/** The hard `default` spec wins; `softDefault` is the fallback. */
function chosenDefaultSpec(config: unknown): ConfiguredDefaultSpec | undefined {
  const specs = (config as { modelSpecs?: { list?: unknown } } | null | undefined)?.modelSpecs?.list;
  if (!Array.isArray(specs)) {
    return undefined;
  }
  const list = specs as ConfiguredDefaultSpec[];
  return (
    list.find((spec) => spec?.default === true) ??
    list.find((spec) => spec?.softDefault === true)
  );
}

/**
 * The deployment's default model with the endpoint that advertises it.
 *
 * Returning null is deliberate: a spec that only names an agent has no concrete
 * model, and guessing one would route inference to an endpoint nobody chose.
 */
export function resolveConfiguredDefault(config: unknown): ConfiguredDefaultModel | null {
  const preset = chosenDefaultSpec(config)?.preset;
  const model = preset?.model;
  if (typeof model !== 'string' || model.trim() === '') {
    return null;
  }
  const id = model.trim();
  const endpoint = preset?.endpoint;
  const provider = typeof endpoint === 'string' && endpoint.trim() !== '' ? endpoint.trim() : '';
  return provider ? { id, provider } : { id };
}

/** The configured default's model id, for callers that do not need its endpoint. */
export function resolveConfiguredDefaultModel(config: unknown): string | null {
  return resolveConfiguredDefault(config)?.id ?? null;
}

export function createConfiguredDefaultResolver<TConfig, TDefault>(
  loadAppConfig: (req: ConfiguredDefaultRequest<TConfig>) => Promise<TConfig | null | undefined>,
  resolveDefault: (config: TConfig | null | undefined) => TDefault,
): (req: ConfiguredDefaultRequest<TConfig>) => Promise<TDefault | null> {
  if (typeof loadAppConfig !== 'function' || typeof resolveDefault !== 'function') {
    throw new TypeError('createConfiguredDefaultResolver requires load and resolve functions');
  }

  return async function resolveConfiguredDefault(req) {
    let config = req?.config;
    if (config == null) {
      try {
        config = await loadAppConfig(req);
      } catch {
        return null;
      }
    }
    if (req && typeof req === 'object' && req.config == null && config != null) {
      req.config = config;
    }
    return resolveDefault(config);
  };
}
