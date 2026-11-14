const { createBlockRetiredSetupToken } = require('@coderax/api');
const { getUserById } = require('~/models');

module.exports = createBlockRetiredSetupToken({ getUserById });
