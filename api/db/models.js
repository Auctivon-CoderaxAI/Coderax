const mongoose = require('mongoose');
const { createModels } = require('@coderax/data-schemas');
const models = createModels(mongoose);

module.exports = { ...models };
