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

jest.mock('~/server/services/PermissionService', () => ({
  getAccessibleMcpServerNames: jest.fn(),
}));

jest.mock('~/server/services/Files/permissions', () => ({
  filterFilesByAgentAccess: jest.fn(),
}));

const db = require('~/models');
const { getAccessibleMcpServerNames } = require('~/server/services/PermissionService');
const { filterFilesByAgentAccess } = require('~/server/services/Files/permissions');
const { buildAgentDbMethods } = require('../dbMethodsFactory');

describe('buildAgentDbMethods', () => {
  const DEFAULT_KEYS = [
    'getProjectFiles',
    'getFiles',
    'getUserKey',
    'getMessages',
    'getConvoFiles',
    'getAccessibleMcpServerNames',
    'updateFilesUsage',
    'getUserCodeFiles',
    'getUserKeyValues',
    'getToolFilesByIds',
    'getCodeGeneratedFiles',
    'getDeferredProvisionFiles',
    'filterFilesByAgentAccess',
    'getRoleByName',
    'getUserAgentPermissions',
  ];

  it('includes all default db methods when called with no overrides', () => {
    const result = buildAgentDbMethods();

    expect(Object.keys(result).sort()).toEqual(DEFAULT_KEYS.sort());
    expect(result.getProjectFiles).toBe(db.getProjectFiles);
    expect(result.getFiles).toBe(db.getFiles);
    expect(result.getUserKey).toBe(db.getUserKey);
    expect(result.getMessages).toBe(db.getMessages);
    expect(result.getConvoFiles).toBe(db.getConvoFiles);
    expect(result.getAccessibleMcpServerNames).toBe(getAccessibleMcpServerNames);
    expect(result.updateFilesUsage).toBe(db.updateFilesUsage);
    expect(result.getUserCodeFiles).toBe(db.getUserCodeFiles);
    expect(result.getUserKeyValues).toBe(db.getUserKeyValues);
    expect(result.getToolFilesByIds).toBe(db.getToolFilesByIds);
    expect(result.getCodeGeneratedFiles).toBe(db.getCodeGeneratedFiles);
    expect(result.getDeferredProvisionFiles).toBe(db.getDeferredProvisionFiles);
    expect(result.filterFilesByAgentAccess).toBe(filterFilesByAgentAccess);
    expect(result.getRoleByName).toBe(db.getRoleByName);
    expect(result.getUserAgentPermissions).toBe(db.getUserAgentPermissions);
  });

  it('merges addedConvo.js-style skill overrides without dropping defaults', () => {
    const skillDbMethods = {
      listSkillsByAccess: jest.fn(),
      listAlwaysApplySkills: jest.fn(),
      getSkillByName: jest.fn(),
    };

    const result = buildAgentDbMethods({
      listSkillsByAccess: skillDbMethods.listSkillsByAccess,
      listAlwaysApplySkills: skillDbMethods.listAlwaysApplySkills,
      getSkillByName: skillDbMethods.getSkillByName,
    });

    // defaults preserved
    expect(result.getProjectFiles).toBe(db.getProjectFiles);
    expect(result.getRoleByName).toBe(db.getRoleByName);

    // overrides merged
    expect(result.listSkillsByAccess).toBe(skillDbMethods.listSkillsByAccess);
    expect(result.listAlwaysApplySkills).toBe(skillDbMethods.listAlwaysApplySkills);
    expect(result.getSkillByName).toBe(skillDbMethods.getSkillByName);
  });

  it('merges initialize.js-style provisioning overrides without dropping defaults', () => {
    const overrides = {
      provisionToCodeEnv: jest.fn(),
      provisionToVectorDB: jest.fn(),
      checkSessionsAlive: jest.fn(),
      loadCodeApiKey: jest.fn(),
      updateFile: jest.fn(),
    };

    const result = buildAgentDbMethods(overrides);

    DEFAULT_KEYS.forEach((key) => {
      expect(result[key]).toBeDefined();
    });

    expect(result.provisionToCodeEnv).toBe(overrides.provisionToCodeEnv);
    expect(result.provisionToVectorDB).toBe(overrides.provisionToVectorDB);
    expect(result.checkSessionsAlive).toBe(overrides.checkSessionsAlive);
    expect(result.loadCodeApiKey).toBe(overrides.loadCodeApiKey);
    expect(result.updateFile).toBe(overrides.updateFile);
  });

  it('allows an override to replace a default method of the same name', () => {
    const customFilter = jest.fn();
    const result = buildAgentDbMethods({ filterFilesByAgentAccess: customFilter });

    expect(result.filterFilesByAgentAccess).toBe(customFilter);
    expect(result.filterFilesByAgentAccess).not.toBe(filterFilesByAgentAccess);
  });

  it('does not mutate the default db module between calls', () => {
    buildAgentDbMethods({ getRoleByName: jest.fn() });
    const second = buildAgentDbMethods();

    expect(second.getRoleByName).toBe(db.getRoleByName);
  });
});