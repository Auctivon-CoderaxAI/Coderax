require('dotenv').config();

const { bootstrapCredentials } = require('@coderax/api/credentials');

module.exports = bootstrapCredentials();
