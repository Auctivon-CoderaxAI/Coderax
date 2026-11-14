const {
  GenerationJobManager,
  createMessageRequestMiddleware,
  isPendingActionStale,
} = require('@coderax/api');
const { logger } = require('@coderax/data-schemas');
const { getConvoOwnership } = require('~/models');

module.exports = createMessageRequestMiddleware({
  getConvo: getConvoOwnership,
  getJob: (conversationId) => GenerationJobManager.getJob(conversationId),
  isPendingActionStale,
  logger,
});
