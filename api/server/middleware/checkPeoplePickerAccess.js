const { createPeoplePickerAccess } = require('@coderax/api');
const { getRoleByName } = require('~/models');

const checkPeoplePickerAccess = createPeoplePickerAccess({ getRoleByName });

module.exports = {
  checkPeoplePickerAccess,
};
