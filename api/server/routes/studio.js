const express = require('express');
const {
  isEnabled,
  limiterCache,
  createStudioGenerateHandler,
  createStudioGenerateLimiter,
  createModelGatewayStudioGeneratorFromEnv,
} = require('@coderax/api');
const { requireJwtAuth } = require('~/server/middleware');

const router = express.Router();

/** `null` (→ 503 NOT_CONFIGURED) unless STUDIO_MODEL_GATEWAY_URL and STUDIO_MODEL are set. */
const generate = createStudioGenerateHandler({
  isStudioEnabled: () => isEnabled(process.env.ENABLE_STUDIO_GENERATION),
  generator: createModelGatewayStudioGeneratorFromEnv(),
});
const studioGenerateLimiter = createStudioGenerateLimiter({
  store: limiterCache('studio_generate_user_limiter'),
});

router.use(requireJwtAuth);
router.post('/generate', studioGenerateLimiter, generate);

module.exports = router;