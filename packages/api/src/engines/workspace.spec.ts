import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { resolveEngineWorkspace, validateWorkspaceRoots } from './workspace';

describe('engine workspace confinement', () => {
  let base: string;
  let privateRoot: string;
  let cloudRoot: string;

  beforeEach(async () => {
    base = await mkdtemp(path.join(os.tmpdir(), 'coderax-workspace-'));
    privateRoot = path.join(base, 'private');
    cloudRoot = path.join(base, 'cloud');
    await mkdir(privateRoot);
    await mkdir(cloudRoot);
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('accepts a workspace inside its own mode root', async () => {
    const workspace = path.join(privateRoot, 'repo');
    await mkdir(workspace);

    const result = await resolveEngineWorkspace({
      mode: 'private',
      requestedRoot: workspace,
      roots: { private: privateRoot, cloud: cloudRoot },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mode).toBe('private');
      expect(result.value.root).toBe(
        await import('node:fs/promises').then((fs) => fs.realpath(workspace)),
      );
    }
  });

  it('refuses a private workspace for a cloud run', async () => {
    const result = await resolveEngineWorkspace({
      mode: 'cloud',
      requestedRoot: privateRoot,
      roots: { private: privateRoot, cloud: cloudRoot },
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: 'workspace_denied' }),
      }),
    );
  });

  it('refuses traversal outside the mode root', async () => {
    const result = await resolveEngineWorkspace({
      mode: 'private',
      requestedRoot: path.join(privateRoot, '..', 'cloud'),
      roots: { private: privateRoot, cloud: cloudRoot },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('workspace_denied');
    }
  });

  it('refuses overlapping private and cloud roots', async () => {
    const result = await validateWorkspaceRoots({
      private: privateRoot,
      cloud: path.join(privateRoot, 'cloud'),
    });

    expect(result.ok).toBe(false);
  });

  it('does not follow a symlink that escapes the mode root', async () => {
    const escape = path.join(privateRoot, 'escape');
    try {
      await symlink(cloudRoot, escape, 'junction');
    } catch {
      // Creating links can be restricted on Windows; the traversal test above
      // still covers the path check, so skip only the link assertion.
      return;
    }

    const result = await resolveEngineWorkspace({
      mode: 'private',
      requestedRoot: escape,
      roots: { private: privateRoot, cloud: cloudRoot },
    });

    expect(result.ok).toBe(false);
  });
});
