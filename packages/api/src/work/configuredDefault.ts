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
