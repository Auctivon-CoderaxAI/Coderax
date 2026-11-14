const mongoose = require('mongoose');
const { createModels } = require('@coderax/data-schemas/models');
const models = createModels(mongoose);

module.exports = { ...models };
