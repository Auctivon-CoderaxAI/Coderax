const { createAgentTitleService } = require('@coderax/api');
const { logger } = require('@coderax/data-schemas');
const { CacheKeys } = require('coderax-data-provider');
const getLogStores = require('~/cache/getLogStores');
const { saveConvo, getConvo } = require('~/models');

module.exports = createAgentTitleService({
  saveConvo,
  getConvo,
  logger,
  getTitleCache: () => getLogStores(CacheKeys.GEN_TITLE),
  titleEnabled: () => process.env.TITLE_CONVO ?? true,
});
