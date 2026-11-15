const db = require('~/models');
const { getAccessibleMcpServerNames } = require('~/server/services/PermissionService');
const { filterFilesByAgentAccess } = require('~/server/services/Files/permissions');

/**
 * Builds the shared db-method dependency object passed into
 * `initializeAgentOptions` call sites (initialize.js, addedConvo.js,
 * openai.js, responses.js). Centralizing this prevents the four
 * call sites from silently diverging when a new db method is required.
 *
 * @param {Object} [overrides] - per-call-site overrides (e.g. filterFilesByAgentAccess variants)
 */
function buildAgentDbMethods(overrides = {}) {
  return {
    getProjectFiles: db.getProjectFiles,
    getFiles: db.getFiles,
    getUserKey: db.getUserKey,
    getMessages: db.getMessages,
    getConvoFiles: db.getConvoFiles,
    getAccessibleMcpServerNames,
    updateFilesUsage: db.updateFilesUsage,
    getUserCodeFiles: db.getUserCodeFiles,
    getUserKeyValues: db.getUserKeyValues,
    getToolFilesByIds: db.getToolFilesByIds,
    getCodeGeneratedFiles: db.getCodeGeneratedFiles,
    getDeferredProvisionFiles: db.getDeferredProvisionFiles,
    filterFilesByAgentAccess,
    getRoleByName: db.getRoleByName,
    getUserAgentPermissions: db.getUserAgentPermissions,
    ...overrides,
  };
}

module.exports = { buildAgentDbMethods };