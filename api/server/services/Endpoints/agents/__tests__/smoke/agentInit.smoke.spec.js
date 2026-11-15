jest.mock('~/models', () => ({
  getProjectFiles: jest.fn(),
  getFiles: jest.fn(),
  getUserKey: jest.fn(),
  getMessages: jest.fn(),
  getConvoFiles: jest.fn(),
  updateFilesUsage: jest.fn(),
  getUserCodeFiles: jest.fn(),
  getUserKeyValues: jest.fn(),
  getToolFilesByIds: jest.fn(),
  getCodeGeneratedFiles: jest.fn(),
  getDeferredProvisionFiles: jest.fn(),
  getRoleByName: jest.fn(),
  getUserAgentPermissions: jest.fn(),
}));
jest.mock('~/server/services/PermissionService', () => ({ getAccessibleMcpServerNames: jest.fn() }));
jest.mock('~/server/services/Files/permissions', () => ({ filterFilesByAgentAccess: jest.fn() }));

const db = require('~/models');
const { filterFilesByAgentAccess } = require('~/server/services/Files/permissions');
const { buildAgentDbMethods } = require('../../dbMethodsFactory');

describe('agent init db methods isolation (dbMethodsFactory.js)', () => {
  it('returns a fresh object per call site so mutating one never affects another', () => {
    const initializeMethods = buildAgentDbMethods();
    const addedConvoMethods = buildAgentDbMethods();

    initializeMethods.getFiles = jest.fn();

    expect(addedConvoMethods).not.toBe(initializeMethods);
    expect(addedConvoMethods.getFiles).toBe(db.getFiles);
  });

  it('keeps one call site override out of the next call site', () => {
    const openaiFilter = jest.fn();

    const openaiMethods = buildAgentDbMethods({ filterFilesByAgentAccess: openaiFilter });
    const responsesMethods = buildAgentDbMethods();

    expect(openaiMethods.filterFilesByAgentAccess).toBe(openaiFilter);
    expect(responsesMethods.filterFilesByAgentAccess).toBe(filterFilesByAgentAccess);
  });

  it('lets an explicit undefined override remove a default method', () => {
    const methods = buildAgentDbMethods({ getUserKey: undefined });

    expect(Object.prototype.hasOwnProperty.call(methods, 'getUserKey')).toBe(true);
    expect(methods.getUserKey).toBeUndefined();
    expect(methods.getFiles).toBe(db.getFiles);
  });
});