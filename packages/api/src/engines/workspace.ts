import path from 'node:path';
import { realpath } from 'node:fs/promises';
import type { DataMode } from './types';
import { engineFailure } from './types';
import type { EngineFailure, EngineResult } from './types';

/**
 * A workspace root is the only filesystem authority an execution engine gets.
 * It is resolved to a real path and must sit inside the root for its own data
 * mode. A private workspace can never be handed to a cloud run, and a cloud
 * workspace can never overlap the private root.
 */

export type WorkspaceRoots = Record<DataMode, string>;

export type ResolvedWorkspace = {
  mode: DataMode;
  root: string;
  /** The configured mode root the workspace was confined to. */
  confinement: string;
};

const isWindows = process.platform === 'win32';

function normalize(value: string): string {
  const resolved = path.resolve(value);
  return isWindows ? resolved.toLowerCase() : resolved;
}

function isInside(candidate: string, parent: string): boolean {
  const left = normalize(candidate);
  const right = normalize(parent);
  return left === right || left.startsWith(right.endsWith(path.sep) ? right : right + path.sep);
}

async function realOrNull(value: string): Promise<string | null> {
  try {
    return await realpath(value);
  } catch {
    return null;
  }
}

/**
 * Roots must exist, be absolute, be distinct and not contain one another.
 * Overlapping roots would let one mode read the other's files, so the whole
 * configuration is refused instead of silently preferring one.
 */
export async function validateWorkspaceRoots(
  roots: WorkspaceRoots,
): Promise<EngineResult<{ roots: WorkspaceRoots }>> {
  const privateRoot = await realOrNull(roots.private);
  const cloudRoot = await realOrNull(roots.cloud);
  if (!privateRoot || !cloudRoot) {
    return engineFailure('not_configured', 'A workspace root does not exist.');
  }
  if (!path.isAbsolute(roots.private) || !path.isAbsolute(roots.cloud)) {
    return engineFailure('not_configured', 'Workspace roots must be absolute paths.');
  }
  if (isInside(privateRoot, cloudRoot) || isInside(cloudRoot, privateRoot)) {
    return engineFailure('not_configured', 'Private and cloud workspace roots must not overlap.');
  }
  return {
    ok: true,
    value: { roots: { private: privateRoot, cloud: cloudRoot } },
  };
}

/**
 * Confine a requested working directory to its mode root. Both the requested
 * directory and the mode root are resolved through symlinks, so a link that
 * points into the other mode is rejected rather than followed.
 */
export async function resolveEngineWorkspace(input: {
  mode: DataMode;
  requestedRoot: string;
  roots: WorkspaceRoots;
}): Promise<EngineResult<ResolvedWorkspace>> {
  const confinement = await realOrNull(input.roots[input.mode]);
  if (!confinement) {
    return engineFailure('not_configured', 'The workspace root for this mode is unavailable.');
  }
  const otherMode: DataMode = input.mode === 'private' ? 'cloud' : 'private';
  const otherConfinement = await realOrNull(input.roots[otherMode]);
  if (
    otherConfinement &&
    (isInside(confinement, otherConfinement) || isInside(otherConfinement, confinement))
  ) {
    return engineFailure('not_configured', 'Configured workspace roots overlap.');
  }

  const requested = await realOrNull(input.requestedRoot);
  if (!requested) {
    return engineFailure('workspace_denied', 'The requested workspace does not exist.');
  }
  if (!isInside(requested, confinement)) {
    return engineFailure('workspace_denied', 'The requested workspace is outside its mode root.');
  }
  if (otherConfinement && isInside(requested, otherConfinement)) {
    return engineFailure('workspace_denied', 'The requested workspace belongs to another mode.');
  }

  return {
    ok: true,
    value: { mode: input.mode, root: requested, confinement },
  };
}

/**
 * Map an adapter failure onto the shared failure shape. Kept here so an
 * adapter cannot invent a cross-mode reason: only these workspace codes exist.
 */
export function workspaceDenied(): EngineFailure {
  return engineFailure('workspace_denied', 'The workspace is not available to this run.');
}
