'use strict';

const express = require('express');
const { createProxyHandler } = require('./proxy-handler');

// This Express service deliberately does not import the database-backed API.
// The origin server owns auth, rate limits, persistence, and model inference.
const app = express();
app.use(createProxyHandler());

module.exports = app;
