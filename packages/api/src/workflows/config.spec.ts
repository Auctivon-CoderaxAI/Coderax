import { validateBuildWorkspaceEnvironment } from './config';

const options = (workspaceEnvironmentId: string) => ({
  buildVerification: {
    workspaceRoot: '/srv/builds',
    workspaceEnvironmentId,
    commands: [{ gate: 'tests' as const, command: 'npm' }],
  },
});

describe('validateBuildWorkspaceEnvironment', () => {
  it('rejects an id that no configured environment owns', () => {
    expect(() =>
      validateBuildWorkspaceEnvironment(options('build-machien'), [
        { id: 'build-machine', type: 'attached' },
      ]),
    ).toThrow(
      'workflows.buildVerification.workspaceEnvironmentId "build-machien" is not a configured stateful-code environment. Configured environments: build-machine.',
    );
  });

  it('names the missing configuration when no environment is configured', () => {
    expect(() => validateBuildWorkspaceEnvironment(options('build-machine'), undefined)).toThrow(
      'No environments are configured under endpoints.agents.statefulCodeSessions.environments.',
    );
  });

  it('rejects a configured environment that is not attached', () => {
    expect(() =>
      validateBuildWorkspaceEnvironment(options('build-machine'), [
        { id: 'build-machine', type: 'managed' },
      ]),
    ).toThrow(
      'workflows.buildVerification.workspaceEnvironmentId "build-machine" must name an attached stateful-code environment; it is configured as managed.',
    );
  });

  it('rejects an environment that does not allow the source checkout', () => {
    expect(() =>
      validateBuildWorkspaceEnvironment(options('build-machine'), [
        { id: 'build-machine', type: 'attached' },
      ]),
    ).toThrow(
      'workflows.buildVerification.workspaceEnvironmentId "build-machine" must allow explicit source checkout selection: set configSchema.workspaces.allowCheckoutSelection to true so build steps and settlement use the same registered checkout.',
    );
  });

  it('accepts a configured attached environment that allows the source checkout', () => {
    expect(() =>
      validateBuildWorkspaceEnvironment(options('build-machine'), [
        {
          id: 'build-machine',
          type: 'attached',
          configSchema: { workspaces: { allowCheckoutSelection: true } },
        },
      ]),
    ).not.toThrow();
  });

  it('leaves arming unchanged when no verifier is configured', () => {
    expect(() => validateBuildWorkspaceEnvironment({}, [])).not.toThrow();
  });
});
