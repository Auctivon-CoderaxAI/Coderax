import type { TToolApprovalPolicy } from './config';

/**
 * Case-sensitive glob where `*` spans any run of characters, matching administrator rules.
 *
 * Implemented as ordered substring search rather than a converted RegExp. A pattern with many
 * wildcards would otherwise let the backtracking engine try a combinatorial number of splits
 * on a long, non-matching tool name, and the caller cannot interrupt that synchronous work.
 */
export function matchesToolPattern(pattern: string, toolName: string): boolean {
  if (!pattern.includes('*')) return pattern === toolName;
  const segments = pattern.split('*');
  const first = segments[0];
  if (!toolName.startsWith(first)) return false;
  let cursor = first.length;
  for (const segment of segments.slice(1, -1)) {
    if (segment === '') continue;
    const found = toolName.indexOf(segment, cursor);
    if (found < 0) return false;
    cursor = found + segment.length;
  }
  const last = segments[segments.length - 1];
  if (last === '') return true;
  return toolName.endsWith(last) && toolName.length - last.length >= cursor;
}

/** Presentation-only constraints. Execution remains owned by the SDK policy hook. */
export function getToolApprovalConstraint(
  policy: TToolApprovalPolicy,
  toolName: string,
): 'ask' | 'deny' | undefined {
  if (policy?.enabled !== true) return undefined;
  const matches = (patterns?: string[]) =>
    patterns?.some((pattern) => matchesToolPattern(pattern, toolName)) === true;
  if (matches(policy.deny)) return 'deny';
  if (matches(policy.ask)) return 'ask';
  if (matches(policy.allow)) return undefined;
  if (policy.mode === 'dontAsk') return 'deny';
  if (policy.mode !== 'bypass') return 'ask';
  return undefined;
}
