import { createHash, randomBytes } from 'node:crypto';
import type { DataMode } from '../engines/types';

/**
 * Private/Cloud isolation is enforced here, structurally, not by prompt text.
 *
 * - A cloud actor may never name a private resource, and a private actor may
 *   never name a cloud resource.
 * - Exporting content to an external inference provider requires an explicit,
 *   single-use approval bound to the exact content and the requesting owner.
 * - A cloud request is built only from user-authored or cloud resources; a
 *   private resource cannot be smuggled in as an entry and no text in a prompt
 *   can change a decision.
 */

export type ModeResourceKind =
  | 'conversation'
  | 'workspace'
  | 'memory'
  | 'embedding'
  | 'index'
  | 'tool_output'
  | 'log'
  | 'credential';

export type ModeResource = {
  mode: DataMode;
  kind: ModeResourceKind;
  id: string;
};

export type ModeActor = {
  userId: string;
  mode: DataMode;
  /** The application is owner-only; every actor must prove ownership. */
  isOwner: boolean;
};

export type ModeDenialCode =
  | 'not_owner'
  | 'cross_mode_denied'
  | 'unknown_resource'
  | 'approval_required'
  | 'approval_invalid'
  | 'approval_expired'
  | 'private_content_denied'
  | 'empty_content';

export type ModeDecision = { ok: true } | { ok: false; code: ModeDenialCode };

export function checkModeAccess(actor: ModeActor, resource: ModeResource): ModeDecision {
  if (!actor.isOwner || !actor.userId) {
    return { ok: false, code: 'not_owner' };
  }
  if (!resource.id) {
    return { ok: false, code: 'unknown_resource' };
  }
  if (actor.mode !== resource.mode) {
    return { ok: false, code: 'cross_mode_denied' };
  }
  return { ok: true };
}

export type ExportSource = 'user_input' | 'cloud_resource' | 'private_resource';

export type ExportEntry = {
  source: ExportSource;
  text: string;
};

export type ExportApproval = {
  token: string;
  contentHash: string;
  userId: string;
  mode: 'cloud';
  expiresAt: number;
};

export type ModeBoundaryOptions = {
  roots: Record<DataMode, string>;
  approvalTtlMs?: number;
  now?: () => number;
};

function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Private resources are refused before a token can even be issued, so an
 * approval cannot be used to legitimise the wrong source.
 */
function containsPrivate(entries: readonly ExportEntry[]): boolean {
  return entries.some((entry) => entry.source === 'private_resource');
}

function contentOf(entries: readonly ExportEntry[]): string {
  // Order and separators are part of the hash: an approval covers this exact
  // payload, so reordering or appending a message invalidates it.
  return entries.map((entry) => `${entry.source}\u0000${entry.text}`).join('\u0001');
}

export class ModeBoundary {
  private readonly approvals = new Map<string, ExportApproval>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(private readonly options: ModeBoundaryOptions) {
    this.ttlMs = options.approvalTtlMs ?? 5 * 60_000;
    this.now = options.now ?? Date.now;
  }

  workspaceFor(mode: DataMode): string {
    return this.options.roots[mode];
  }

  assertAccess(actor: ModeActor, resource: ModeResource): ModeDecision {
    return checkModeAccess(actor, resource);
  }

  /** Issue an approval for one exact cloud payload. Private entries are refused. */
  createApproval(
    actor: ModeActor,
    entries: readonly ExportEntry[],
  ): { ok: true; approval: ExportApproval } | { ok: false; code: ModeDenialCode } {
    if (!actor.isOwner || !actor.userId) {
      return { ok: false, code: 'not_owner' };
    }
    if (actor.mode !== 'cloud') {
      return { ok: false, code: 'cross_mode_denied' };
    }
    if (entries.length === 0 || entries.every((entry) => !entry.text.trim())) {
      return { ok: false, code: 'empty_content' };
    }
    if (containsPrivate(entries)) {
      return { ok: false, code: 'private_content_denied' };
    }
    const approval: ExportApproval = {
      token: randomBytes(32).toString('hex'),
      contentHash: hashContent(contentOf(entries)),
      userId: actor.userId,
      mode: 'cloud',
      expiresAt: this.now() + this.ttlMs,
    };
    this.approvals.set(approval.token, approval);
    return { ok: true, approval };
  }

  /**
   * Consume an approval exactly once. The token is bound to the owner, the
   * cloud mode, the exact payload and a short expiry.
   */
  consumeApproval(
    actor: ModeActor,
    token: string,
    entries: readonly ExportEntry[],
  ): ModeDecision {
    if (!actor.isOwner || !actor.userId) {
      return { ok: false, code: 'not_owner' };
    }
    if (actor.mode !== 'cloud') {
      return { ok: false, code: 'cross_mode_denied' };
    }
    if (containsPrivate(entries)) {
      return { ok: false, code: 'private_content_denied' };
    }
    const approval = this.approvals.get(token);
    if (!approval || approval.userId !== actor.userId || approval.mode !== 'cloud') {
      return { ok: false, code: 'approval_invalid' };
    }
    if (approval.expiresAt <= this.now()) {
      this.approvals.delete(token);
      return { ok: false, code: 'approval_expired' };
    }
    if (approval.contentHash !== hashContent(contentOf(entries))) {
      return { ok: false, code: 'approval_invalid' };
    }
    this.approvals.delete(token);
    return { ok: true };
  }

  /**
   * Build the exact text a cloud provider would receive. This is the only
   * function that may hand content to external inference, and it refuses
   * private entries and unapproved payloads.
   */
  authorizeExport(
    actor: ModeActor,
    input: { entries: readonly ExportEntry[]; approvalToken?: string | null },
  ): { ok: true; text: string } | { ok: false; code: ModeDenialCode } {
    const decision = input.approvalToken
      ? this.consumeApproval(actor, input.approvalToken, input.entries)
      : ({ ok: false, code: 'approval_required' } as const);
    if (!decision.ok) {
      return decision;
    }
    const text = input.entries.map((entry) => entry.text).join('\n\n');
    return { ok: true, text };
  }

  /** Expired approvals are removed opportunistically; tokens are never listed. */
  prune(): void {
    const now = this.now();
    for (const [token, approval] of this.approvals) {
      if (approval.expiresAt <= now) {
        this.approvals.delete(token);
      }
    }
  }
}
