const mongoose = require('mongoose');
const { createSharedLinkAccessMiddleware } = require('@coderax/api');

const canAccessSharedLink = createSharedLinkAccessMiddleware({ mongoose });

module.exports = canAccessSharedLink;
