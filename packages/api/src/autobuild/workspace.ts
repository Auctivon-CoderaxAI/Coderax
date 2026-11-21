import {
  WORKFLOW_BUILD_BASE_REF_MAX_LENGTH,
  WORKFLOW_BUILD_REPOSITORY_PART_MAX_LENGTH,
  WORKFLOW_BUILD_WORKSPACE_MAX_LENGTH,
} from 'coderax-data-provider';
import type { WorkflowBuildRepository } from 'coderax-data-provider';

/**
 * An owner or repository name is one path-free label. `..` cannot match because
 * a label starts with a letter or digit.
 */
const REPOSITORY_PART = new RegExp(
  `^[A-Za-z0-9][A-Za-z0-9_.-]{0,${WORKFLOW_BUILD_REPOSITORY_PART_MAX_LENGTH - 1}}$`,
);

/** A branch ref may contain `/`, but never traversal or an empty segment. */
const BASE_REF = new RegExp(
  `^[A-Za-z0-9][A-Za-z0-9._/-]{0,${WORKFLOW_BUILD_BASE_REF_MAX_LENGTH - 1}}$`,
);

/** One relative directory name, so a checkout cannot escape the build root. */
const WORKSPACE = new RegExp(
  `^[A-Za-z0-9][A-Za-z0-9._-]{0,${WORKFLOW_BUILD_WORKSPACE_MAX_LENGTH - 1}}$`,
);

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function isBuildRepositoryPart(value: string): boolean {
  return REPOSITORY_PART.test(value);
}

export function isBuildBaseRef(value: string): boolean {
  return (
    BASE_REF.test(value) &&
    !value.includes('..') &&
    !value.includes('//') &&
    !value.endsWith('/') &&
    !value.endsWith('.lock')
  );
}

export function isBuildWorkspace(value: string): boolean {
  return WORKSPACE.test(value);
}

/** Bounds and flattens an operator-supplied repository before it is persisted. */
export function normalizeBuildRepository(
  value: WorkflowBuildRepository | undefined,
): WorkflowBuildRepository | null {
  if (value == null) {
    return null;
  }
  const owner = text(value.owner);
  const name = text(value.name);
  if (!isBuildRepositoryPart(owner) || !isBuildRepositoryPart(name)) {
    return null;
  }
  const baseRef = text(value.baseRef);
  if (baseRef.length > 0 && !isBuildBaseRef(baseRef)) {
    return null;
  }
  return { owner, name, ...(baseRef.length === 0 ? {} : { baseRef }) };
}
