import type { CommandRunner, VerificationCommand } from './verify';

/**
 * Deployment verification policy. The workspace root and argv are deployment
 * configuration rather than request input, so a build plan can never choose
 * where settlement runs or which executable it invokes.
 */
export interface BuildVerificationConfig {
  /** Absolute directory holding one checkout per build workspace. */
  workspaceRoot: string;
  /** Attached code environment that hosts those checkouts, one registered
   *  workspace id per directory name. Build steps run their turns there, so the
   *  reservation covers editing instead of only settlement. */
  workspaceEnvironmentId: string;
  commands: VerificationCommand[];
  /** Replaces the default executable allowlist when supplied. */
  allowedCommands?: readonly string[];
  /** Waives the reviewable-pull-request requirement when false. */
  requirePullRequest?: boolean;
  defaultTimeoutMs?: number;
  /** Process runner override, for hosts and tests that must not spawn. */
  runner?: CommandRunner;
}
