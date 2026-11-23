import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/* Use the parser the API already declares instead of relying on hoisting. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const yaml = createRequire(path.join(ROOT, 'packages', 'data-provider', 'package.json'))('js-yaml');

export const CONFIG_VERSION = '1.3.17';
export const LOCAL_ENDPOINT_NAME = 'llamacpp';

function mapping(value, label) {
  if (value == null) {
    return {};
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a YAML mapping.`);
  }
  return value;
}

export function localEndpoint({ modelPort, modelId }) {
  return {
    name: LOCAL_ENDPOINT_NAME,
    apiKey: 'local',
    baseURL: `http://127.0.0.1:${modelPort}/v1`,
    models: { default: [modelId], fetch: true },
    titleConvo: false,
    modelDisplayLabel: 'llama.cpp (local)',
  };
}

function endpointFor(existing, options) {
  const endpoint = mapping(existing, `coderax.yaml endpoints.custom ${LOCAL_ENDPOINT_NAME}`);
  const models = mapping(endpoint.models, `coderax.yaml ${LOCAL_ENDPOINT_NAME}.models`);
  return {
    ...endpoint,
    ...localEndpoint(options),
    apiKey: typeof endpoint.apiKey === 'string' && endpoint.apiKey ? endpoint.apiKey : 'local',
    models: { ...models, default: [options.modelId], fetch: models.fetch ?? true },
  };
}

export function needsLocalConfig(existing, options) {
  const config = mapping(existing, 'coderax.yaml');
  if (config.freeInference?.enabled !== true) {
    return true;
  }
  const endpoints = mapping(config.endpoints, 'coderax.yaml endpoints');
  if (!Array.isArray(endpoints.custom)) {
    return true;
  }
  const endpoint = endpoints.custom.find((entry) => entry?.name === LOCAL_ENDPOINT_NAME);
  if (!endpoint) {
    return true;
  }
  return (
    endpoint.baseURL !== localEndpoint(options).baseURL ||
    endpoint.models?.default?.[0] !== options.modelId
  );
}

export function mergeLocalConfig(existing, options) {
  const config = mapping(existing, 'coderax.yaml');
  const freeInference = mapping(config.freeInference, 'coderax.yaml freeInference');
  const endpoints = mapping(config.endpoints, 'coderax.yaml endpoints');
  const custom = endpoints.custom == null ? [] : endpoints.custom;
  if (!Array.isArray(custom)) {
    throw new Error('coderax.yaml endpoints.custom must be a list.');
  }
  const current = custom.find((entry) => entry?.name === LOCAL_ENDPOINT_NAME);
  return {
    ...config,
    version: config.version ?? CONFIG_VERSION,
    freeInference: { ...freeInference, enabled: true },
    endpoints: {
      ...endpoints,
      custom: [
        ...custom.filter((entry) => entry?.name !== LOCAL_ENDPOINT_NAME),
        endpointFor(current, options),
      ],
    },
  };
}

/**
 * Appends only top-level sections the config does not have yet. This keeps the
 * existing comments and ordering; structural changes fall back to `mergeLocalConfig`.
 */
export function appendMissingConfig(text, existing, options) {
  const additions = [];
  if (Object.hasOwn(existing, 'version') === false) {
    additions.push(`version: ${CONFIG_VERSION}`);
  }
  if (Object.hasOwn(existing, 'freeInference') === false) {
    additions.push('freeInference:\n  enabled: true');
  }
  if (Object.hasOwn(existing, 'endpoints') === false) {
    const endpoint = localEndpoint(options);
    additions.push(
      [
        'endpoints:',
        '  custom:',
        `    - name: '${endpoint.name}'`,
        `      apiKey: '${endpoint.apiKey}'`,
        `      baseURL: '${endpoint.baseURL}'`,
        '      models:',
        '        default:',
        ...endpoint.models.default.map((model) => `          - '${model}'`),
        '        fetch: true',
        '      titleConvo: false',
        `      modelDisplayLabel: '${endpoint.modelDisplayLabel}'`,
      ].join('\n'),
    );
  }
  if (additions.length === 0) {
    return null;
  }
  return `${text.replace(/\s*$/, '')}\n\n${additions.join('\n\n')}\n`;
}

export function loadConfig(text) {
  const value = yaml.load(text);
  if (value == null) {
    return {};
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('coderax.yaml must contain a YAML mapping.');
  }
  return value;
}

export function dumpConfig(config) {
  return yaml.dump(config, { lineWidth: -1, noRefs: true });
}
