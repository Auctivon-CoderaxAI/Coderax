const swaggerUiDist = require('swagger-ui-dist');
const { createOpenApiRouter } = require('@coderax/api');
const { getAppConfig } = require('~/server/services/Config/app');

module.exports = createOpenApiRouter({
  getAppConfig,
  swaggerAssetsPath: swaggerUiDist.getAbsoluteFSPath(),
});
