const mongoose = require('mongoose');
const {
  CacheKeys,
  mergeFreeInferenceCustomEndpoints,
  mergeProviderFallbackCustomEndpoints,
} = require('coderax-data-provider');
const { runtimeProviderCatalog, mergeCatalogCustomEndpoints } = require('@coderax/api');
const { AppService, logger } = require('@coderax/data-schemas');
const {
  createAppConfigService,
  clearMcpConfigCache,
  createCodeEnvironmentRegistry,
  mergeAccessibleCodeEnvironments,
  cacheConfig,
  standardCache,
} = require('@coderax/api');
const { setCachedTools, invalidateCachedTools } = require('./getCachedTools');
const { loadAndFormatTools } = require('~/server/services/start/tools');
const loadCustomConfig = require('./loadCustomConfig');
const getLogStores = require('~/cache/getLogStores');
const paths = require('~/config/paths');
const db = require('~/models');

let codeEnvironmentRegistry;

function getCodeEnvironmentRegistry() {
  if (codeEnvironmentRegistry == null) {
    codeEnvironmentRegistry = createCodeEnvironmentRegistry(mongoose, {
      configurationCache: cacheConfig.USE_REDIS
        ? standardCache('CODE_ENVIRONMENT_CONFIG')
        : undefined,
    });
  }
  return codeEnvironmentRegistry;
}

async function invalidateCodeEnvironmentConfigCache(tenantId) {
  await getCodeEnvironmentRegistry().invalidateAccessibleConfigurations(tenantId);
}

const loadBaseConfig = async (mode) => {
  /** @type {TCustomConfig} */
  const rawConfig = (await loadCustomConfig(true, { mode })) ?? {};
  /** Opted-in, credentialed $0 providers become ordinary custom endpoints, so the
   *  native runner executes them; without a credential this is a no-op. */
  const withFreeProviders = mergeFreeInferenceCustomEndpoints(rawConfig, process.env);
  /** Credentialed fallback providers become custom endpoints too, with the
   *  other providers attached to each turn as SDK fallbacks. */
  const withFallbackProviders = mergeProviderFallbackCustomEndpoints(
    withFreeProviders,
    process.env,
  );
  /** Discovered, eligible models become custom endpoints as well, so the model
   *  picker and the runner read one configuration. A provider failure keeps the
   *  last known snapshot; a cold failure merges nothing and stays startup-safe. */
  let providerSnapshot = null;
  try {
    providerSnapshot = await runtimeProviderCatalog.snapshot();
  } catch (error) {
    logger.warn('Provider catalog unavailable; serving configured endpoints only', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
  }
  const config = mergeCatalogCustomEndpoints(withFallbackProviders, providerSnapshot);
  /** @type {Record<string, FunctionTool>} */
  const systemTools = loadAndFormatTools({
    adminFilter: config.filteredTools,
    adminIncluded: config.includedTools,
    directory: paths.structuredTools,
  });
  return AppService({ config, paths, systemTools });
};

const { getAppConfig, clearAppConfigCache, clearOverrideCache } = createAppConfigService({
  loadBaseConfig,
  setCachedTools,
  getCache: getLogStores,
  cacheKeys: CacheKeys,
  getApplicableConfigs: db.getApplicableConfigs,
  getUserPrincipals: db.getUserPrincipals,
  augmentConfig: ({ appConfig, baseConfig, principals, options }) => {
    if (!options.userId) return appConfig;
    return mergeAccessibleCodeEnvironments({
      appConfig,
      deploymentConfig: baseConfig,
      actor: {
        userId: options.userId,
        role: options.role ?? null,
        idOnTheSource: options.idOnTheSource ?? null,
        principals,
      },
      registry: getCodeEnvironmentRegistry(),
    });
  },
});

// Config owns the reader; models never import this module to obtain it.
db.initializeMessageBudget(getAppConfig);

/**
 * Invalidate all config-related caches after an admin config mutation.
 * Clears the base config, per-principal override caches, tool caches,
 * and the MCP config-source server cache.
 * @param {string} [tenantId] - Optional tenant ID to scope override cache clearing.
 */
async function invalidateConfigCaches(tenantId) {
  const results = await Promise.allSettled([
    clearAppConfigCache(),
    clearOverrideCache(tenantId),
    invalidateCachedTools({ invalidateGlobal: true }),
    clearMcpConfigCache(),
  ]);
  const labels = [
    'clearAppConfigCache',
    'clearOverrideCache',
    'invalidateCachedTools',
    'clearMcpConfigCache',
  ];
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'rejected') {
      logger.error(`[invalidateConfigCaches] ${labels[i]} failed:`, results[i].reason);
    }
  }
}

module.exports = {
  getAppConfig,
  clearAppConfigCache,
  clearOverrideCache,
  invalidateConfigCaches,
  getCodeEnvironmentRegistry,
  invalidateCodeEnvironmentConfigCache,
};
