const path = require('path');
const { loadYaml, redactConfigSecretMaps, createCustomConfigLoader } = require('@coderax/api');

const projectRoot = path.resolve(__dirname, '..', '..', '..', '..');
const defaultConfigPath = path.resolve(projectRoot, 'coderax.yaml');

module.exports = createCustomConfigLoader({
  loadLocal: loadYaml,
  defaultConfigPath,
  redactConfig: redactConfigSecretMaps,
});
