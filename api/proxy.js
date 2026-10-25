'use strict';

const express = require('express');
const { createProxyHandler } = require('@coderax/api/proxy');

// Keep this legacy Express entrypoint as wiring only. The isolated proxy lives
// in the TypeScript API workspace; the origin server owns database-backed API work.
const app = express();
app.use(createProxyHandler());

module.exports = app;
