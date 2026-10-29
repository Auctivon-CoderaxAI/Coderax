const express = require('express');
const { createAdminCyVoxHandlers } = require('@coderax/api');
const { SystemCapabilities } = require('@coderax/data-schemas');
const {
  hasConfigCapability,
  requireCapability,
} = require('~/server/middleware/roles/capabilities');
const { invalidateConfigCaches } = require('~/server/services/Config');
const { requireJwtAuth } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);

async function requireCyVoxManage(req, res, next) {
  try {
    const id = req.user?.id ?? req.user?._id?.toString();
    if (!id) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    const user = {
      id,
      role: req.user.role ?? '',
      tenantId: req.user.tenantId,
      idOnTheSource: req.user.idOnTheSource ?? null,
    };
    if (await hasConfigCapability(user, 'cyvox')) {
      return next();
    }
    return res.status(403).json({ message: 'Forbidden' });
  } catch (_err) {
    return res.status(500).json({ message: 'Internal Server Error' });
  }
}

const handlers = createAdminCyVoxHandlers({
  findConfigByPrincipal: db.findConfigByPrincipal,
  patchConfigFields: db.patchConfigFields,
  toggleConfigActive: db.toggleConfigActive,
  invalidateConfigCaches,
  environment: {
    enabled: process.env.CYVOX_ADDON_ENABLED === 'true',
    baseUrl: process.env.CYVOX_BASE_URL,
    authToken: process.env.CYVOX_AUTH_TOKEN,
  },
});

router.use(requireJwtAuth, requireAdminAccess, requireCyVoxManage);

router.get('/connection', handlers.getConnection);
router.put('/connection', handlers.updateConnection);
router.post('/connection/test', handlers.testConnection);

module.exports = router;
