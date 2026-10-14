const { logger } = require('@coderax/data-schemas');
const { CacheKeys } = require('coderax-data-provider');
const { createPromptService, createLinkedInstructionsResolver } = require('@coderax/api');
const { grantPermission } = require('~/server/services/PermissionService');
const { getLogStores } = require('~/cache');
const db = require('~/models');

/**
 * Shared resolver for an agent's `instructionsPrompt` link. Resolve and cache
 * logic lives in `@coderax/api` (`createLinkedInstructionsResolver`); this
 * module wires in the Coderax prompt service and the
 * `AGENT_LINKED_INSTRUCTIONS` cache namespace (`~/cache/getLogStores.js`).
 */
const linkedInstructionsResolver = createLinkedInstructionsResolver({
  promptService: createPromptService({ db, grantPermission }),
  cache: getLogStores(CacheKeys.AGENT_LINKED_INSTRUCTIONS),
  logger,
});

/** @returns {import('@coderax/api').ResolveLinkedInstructions} */
function getLinkedInstructionsResolver() {
  return linkedInstructionsResolver;
}

module.exports = { getLinkedInstructionsResolver };
