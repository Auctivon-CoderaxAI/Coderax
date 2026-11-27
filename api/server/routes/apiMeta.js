const {
  createApiMetaRouter,
  apiVersionHeaders,
  rejectUnsupportedApiVersion,
} = require('@coderax/api');

/** Wiring only: the contract, version header and guard live in `@coderax/api`. */
const router = createApiMetaRouter({ commit: process.env.BUILD_COMMIT ?? null });

module.exports = router;
module.exports.experimental = createApiMetaRouter({
  commit: process.env.BUILD_COMMIT ?? null,
  experimental: true,
});
module.exports.apiVersionHeaders = apiVersionHeaders;
module.exports.rejectUnsupportedApiVersion = rejectUnsupportedApiVersion;
