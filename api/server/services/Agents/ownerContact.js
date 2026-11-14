const { logger } = require('@coderax/data-schemas');
const { attachAgentOwnerContacts } = require('@coderax/api');
const db = require('~/models');

const attachOwnerContacts = (agents) =>
  attachAgentOwnerContacts(agents, {
    getFirstOwnerIdsByResource: (resourceType, resourceIds) =>
      db.getFirstOwnerIdsByResource(resourceType, resourceIds),
    findOwnerContactUsers: db.findOwnerContactUsers,
    logger,
  });

module.exports = {
  attachOwnerContacts,
};
