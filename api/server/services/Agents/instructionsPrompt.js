const { logger, SystemCapabilities } = require('@coderax/data-schemas');
const {
  checkAccess,
  createPromptService,
  assertModelBoundContent,
  createInstructionsPromptAccess,
} = require('@coderax/api');
const { Permissions, PermissionTypes } = require('coderax-data-provider');
const {
  grantPermission,
  getResourcePermissionsMap,
} = require('~/server/services/PermissionService');
const { hasCapability } = require('~/server/middleware/roles/capabilities');
const db = require('~/models');

/** Wiring only: the write/present decision logic lives in `@coderax/api` (`createInstructionsPromptAccess`, `checkInstructionsPromptWrite`). */
const instructionsPromptAccess = createInstructionsPromptAccess({
  getResourcePermissionsMap,
  canManagePrompts: (user) => hasCapability(user, SystemCapabilities.MANAGE_PROMPTS),
  promptService: createPromptService({ db, grantPermission }),
  assertAgentInstructionsContent: ({ instructions, filters }) =>
    assertModelBoundContent({ filters, agents: [{ instructions }] }),
  /** The same role-level gate `checkPromptAccess` applies to every `/prompts` route
   *  (`PermissionTypes.PROMPTS`, `Permissions.USE`). Only `.role` is read, so the
   *  `{ id, role }` identity `validateLinkWrite` carries is enough. */
  canUsePrompts: (user, req) =>
    checkAccess({
      req,
      user,
      permissionType: PermissionTypes.PROMPTS,
      permissions: [Permissions.USE],
      getRoleByName: db.getRoleByName,
    }),
  logger,
});

module.exports = { instructionsPromptAccess };
