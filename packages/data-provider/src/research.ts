/**
 * Research Dossier contracts shared by the API and the client.
 *
 * M1 is an evidence ledger, not an autonomous researcher. The owner records
 * the sources they read and the claims they draw from them; this module
 * enforces the bookkeeping (every claim must cite a recorded source, unused
 * sources and contradictions stay visible) and renders a citation-complete
 * report. Nothing here fetches or verifies an external page, so the capability
 * flags on the API and the report's own limitations section must say so.
 */

export const MAX_RESEARCH_TITLE_LENGTH = 140;
export const MAX_RESEARCH_QUESTION_LENGTH = 800;
export const MAX_RESEARCH_SOURCE_TITLE_LENGTH = 200;
export const MAX_RESEARCH_SOURCE_URL_LENGTH = 2048;
export const MAX_RESEARCH_PUBLISHER_LENGTH = 120;
export const MAX_RESEARCH_EXCERPT_LENGTH = 1200;
export const MAX_RESEARCH_NOTE_LENGTH = 600;
export const MAX_RESEARCH_CLAIM_LENGTH = 600;
export const MAX_RESEARCH_SOURCES = 40;
export const MAX_RESEARCH_CLAIMS = 60;
export const MAX_RESEARCH_SOURCES_PER_CLAIM = 8;
export const MAX_RESEARCH_PROJECTS_PER_OWNER_CEILING = 200;
export const DEFAULT_RESEARCH_PROJECTS_PER_OWNER = 50;

export const RESEARCH_SOURCE_KINDS = ['primary', 'secondary', 'opinion'] as const;
export type TResearchSourceKind = (typeof RESEARCH_SOURCE_KINDS)[number];

export const RESEARCH_CLAIM_STATUSES = ['supported', 'contradicted', 'uncertain'] as const;
export type TResearchClaimStatus = (typeof RESEARCH_CLAIM_STATUSES)[number];

/** `unsupported` is derived: a claim with no recorded citation cannot be supported. */
export type TResearchEffectiveClaimStatus = TResearchClaimStatus | 'unsupported';

export const RESEARCH_PROJECT_STATUSES = ['draft', 'collecting', 'review', 'complete'] as const;
export type TResearchProjectStatus = (typeof RESEARCH_PROJECT_STATUSES)[number];

export type TResearchSource = {
  id: string;
  title: string;
  url: string;
  publisher: string;
  kind: TResearchSourceKind;
  /** Quoted or closely paraphrased passage the claim relies on. */
  excerpt: string;
  /** Why the owner trusts this source, or what it is weak on. */
  note: string;
  retrievedAt: string;
};

export type TResearchClaim = {
  id: string;
  text: string;
  status: TResearchClaimStatus;
  sourceIds: string[];
};

export type TResearchProject = {
  _id: string;
  title: string;
  question: string;
  status: TResearchProjectStatus;
  /** Bumped by every write; a save sends the revision it was based on. */
  revision: number;
  sources: TResearchSource[];
  claims: TResearchClaim[];
  createdAt: string;
  updatedAt: string;
};

export type TResearchAuditIssueCode =
  | 'NO_SOURCES'
  | 'NO_CLAIMS'
  | 'CLAIM_WITHOUT_SOURCE'
  | 'CITATION_UNKNOWN_SOURCE'
  | 'SOURCE_UNUSED'
  | 'DUPLICATE_SOURCE_URL'
  | 'CONTRADICTED_CLAIM';

export type TResearchAuditIssue = {
  code: TResearchAuditIssueCode;
  severity: 'error' | 'warning';
  message: string;
  claimId?: string;
  sourceId?: string;
};

export type TResearchAudit = {
  sources: number;
  claims: number;
  primarySources: number;
  distinctDomains: number;
  effective: Record<TResearchEffectiveClaimStatus, number>;
  uncitedSourceIds: string[];
  unknownCitationClaimIds: string[];
  issues: TResearchAuditIssue[];
  /** True only when the ledger has no blocking error and can be marked complete. */
  ready: boolean;
};

export type TResearchDossier = TResearchProject & { audit: TResearchAudit };

export type TResearchProjectListResponse = {
  projects: TResearchDossier[];
  nextCursor: string | null;
};

export type TResearchProjectListParams = {
  cursor?: string | null;
  limit?: number;
  search?: string;
};

export type TCreateResearchProjectRequest = {
  title: string;
  question: string;
};

export type TSaveResearchProjectRequest = {
  researchId: string;
  title: string;
  question: string;
  status: TResearchProjectStatus;
  sources: TResearchSource[];
  claims: TResearchClaim[];
  expectedRevision: number;
};

export type TDeleteResearchProjectRequest = { researchId: string };

/**
 * The server reports what the dossier can and cannot do. `automatedFetch` and
 * `automatedVerification` are false because no fetch or verification worker is
 * wired into this deployment; the UI renders that limitation instead of
 * implying the sources were checked.
 */
export type TResearchCapabilities = {
  ledger: true;
  automatedFetch: false;
  automatedVerification: false;
  reason: string;
};

export const RESEARCH_CAPABILITIES: TResearchCapabilities = {
  ledger: true,
  automatedFetch: false,
  automatedVerification: false,
  reason:
    'This dossier records the sources and citations you enter. Coderax does not fetch, summarise or independently verify external pages in this deployment.',
};

export const RESEARCH_SOURCE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Returns the lowercased host without a leading `www.`, or null for a non-http(s) URL. */
export function researchUrlHost(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** A claim with no citation that resolves to a recorded source is unsupported. */
export function effectiveClaimStatus(
  claim: TResearchClaim,
  knownSourceIds: ReadonlySet<string>,
): TResearchEffectiveClaimStatus {
  const cited = claim.sourceIds.some((sourceId) => knownSourceIds.has(sourceId));
  return cited ? claim.status : 'unsupported';
}

export type TResearchAuditInput = {
  sources: TResearchSource[];
  claims: TResearchClaim[];
};

/**
 * Deterministic bookkeeping over the ledger. This is not a truth score: it
 * reports whether the owner's citations are internally complete, and keeps
 * contradictions and unused sources visible rather than averaging them away.
 */
export function auditResearch({ sources, claims }: TResearchAuditInput): TResearchAudit {
  const knownSourceIds = new Set(sources.map((source) => source.id));
  const citedSourceIds = new Set<string>();
  const effective: Record<TResearchEffectiveClaimStatus, number> = {
    supported: 0,
    contradicted: 0,
    uncertain: 0,
    unsupported: 0,
  };
  const issues: TResearchAuditIssue[] = [];
  const unknownCitationClaimIds: string[] = [];

  for (const claim of claims) {
    const known = claim.sourceIds.filter((sourceId) => knownSourceIds.has(sourceId));
    known.forEach((sourceId) => citedSourceIds.add(sourceId));
    const status = effectiveClaimStatus(claim, knownSourceIds);
    effective[status] += 1;

    const unknown = claim.sourceIds.filter((sourceId) => !knownSourceIds.has(sourceId));
    if (unknown.length > 0) {
      unknownCitationClaimIds.push(claim.id);
      issues.push({
        code: 'CITATION_UNKNOWN_SOURCE',
        severity: 'error',
        claimId: claim.id,
        message: `A claim cites ${unknown.length} source${unknown.length === 1 ? '' : 's'} that no longer exist in the dossier.`,
      });
    }
    if (known.length === 0) {
      issues.push({
        code: 'CLAIM_WITHOUT_SOURCE',
        severity: 'error',
        claimId: claim.id,
        message: 'A claim has no citation, so it is reported as unsupported.',
      });
    }
    if (claim.status === 'contradicted' && known.length > 0) {
      issues.push({
        code: 'CONTRADICTED_CLAIM',
        severity: 'warning',
        claimId: claim.id,
        message: 'A source contradicts this claim; resolve or keep the disagreement explicit.',
      });
    }
  }

  if (sources.length === 0) {
    issues.push({
      code: 'NO_SOURCES',
      severity: 'error',
      message: 'Add at least one source before this dossier can be completed.',
    });
  }
  if (claims.length === 0) {
    issues.push({
      code: 'NO_CLAIMS',
      severity: 'error',
      message: 'Record at least one finding drawn from the sources.',
    });
  }

  const seenUrls = new Map<string, string>();
  const uncitedSourceIds: string[] = [];
  for (const source of sources) {
    if (!citedSourceIds.has(source.id)) {
      uncitedSourceIds.push(source.id);
      issues.push({
        code: 'SOURCE_UNUSED',
        severity: 'warning',
        sourceId: source.id,
        message: 'A recorded source is not cited by any claim.',
      });
    }
    const normalized = source.url.trim().toLowerCase();
    const duplicate = seenUrls.get(normalized);
    if (duplicate) {
      issues.push({
        code: 'DUPLICATE_SOURCE_URL',
        severity: 'warning',
        sourceId: source.id,
        message: `Two sources point at the same URL; the other entry is ${duplicate}.`,
      });
    } else {
      seenUrls.set(normalized, source.id);
    }
  }

  const domains = new Set(
    sources.map((source) => researchUrlHost(source.url)).filter((host): host is string => !!host),
  );
  const ready =
    sources.length > 0 &&
    claims.length > 0 &&
    !issues.some((issue) => issue.severity === 'error') &&
    unknownCitationClaimIds.length === 0;

  return {
    sources: sources.length,
    claims: claims.length,
    primarySources: sources.filter((source) => source.kind === 'primary').length,
    distinctDomains: domains.size,
    effective,
    uncitedSourceIds,
    unknownCitationClaimIds,
    issues,
    ready,
  };
}

export type TResearchReportInput = {
  title: string;
  question: string;
  status: TResearchProjectStatus;
  sources: TResearchSource[];
  claims: TResearchClaim[];
};

const STATUS_LABEL: Record<TResearchProjectStatus, string> = {
  draft: 'Draft',
  collecting: 'Collecting evidence',
  review: 'In review',
  complete: 'Complete',
};

const KIND_LABEL: Record<TResearchSourceKind, string> = {
  primary: 'primary source',
  secondary: 'secondary source',
  opinion: 'opinion',
};

const EFFECTIVE_LABEL: Record<TResearchEffectiveClaimStatus, string> = {
  supported: 'Supported',
  contradicted: 'Contradicted',
  uncertain: 'Uncertain',
  unsupported: 'Unsupported',
};

const escapeInline = (value: string): string => value.replace(/\r?\n+/g, ' ').trim();

/**
 * Renders the dossier as a citable Markdown report. Claims keep their order and
 * appear under their evidence status; only citations that resolve to a recorded
 * source become link markers, so the report cannot cite a missing source.
 */
export function renderResearchReport({
  title,
  question,
  status,
  sources,
  claims,
}: TResearchReportInput): string {
  const knownSourceIds = new Set(sources.map((source) => source.id));
  const citationNumber = new Map(sources.map((source, index) => [source.id, index + 1]));
  const audit = auditResearch({ sources, claims });
  const lines: string[] = [];

  lines.push(`# ${escapeInline(title) || 'Untitled research dossier'}`, '');
  if (question.trim()) {
    lines.push(`**Question:** ${escapeInline(question)}`, '');
  }
  lines.push(`**Status:** ${STATUS_LABEL[status]}`, '');

  lines.push('## Findings', '');
  if (claims.length === 0) {
    lines.push('_No findings recorded yet._', '');
  } else {
    for (const claim of claims) {
      const known = claim.sourceIds.filter((sourceId) => knownSourceIds.has(sourceId));
      const effective = effectiveClaimStatus(claim, knownSourceIds);
      const citations = known
        .map((sourceId) => citationNumber.get(sourceId))
        .filter((value): value is number => value != null)
        .sort((a, b) => a - b)
        .map((value) => `[${value}]`)
        .join('');
      lines.push(
        `- **${EFFECTIVE_LABEL[effective]}** — ${escapeInline(claim.text)}${citations ? ` ${citations}` : ''}`,
      );
    }
    lines.push('');
  }

  lines.push('## Sources', '');
  if (sources.length === 0) {
    lines.push('_No sources recorded._', '');
  } else {
    sources.forEach((source, index) => {
      const publisher = source.publisher.trim() ? ` — ${escapeInline(source.publisher)}` : '';
      const kind = KIND_LABEL[source.kind];
      const retrieved = source.retrievedAt.trim()
        ? `, retrieved ${escapeInline(source.retrievedAt)}`
        : '';
      lines.push(
        `${index + 1}. [${escapeInline(source.title) || 'Untitled source'}](${source.url})${publisher} (${kind}${retrieved})`,
      );
      if (source.note.trim()) {
        lines.push(`   - Note: ${escapeInline(source.note)}`);
      }
      if (source.excerpt.trim()) {
        lines.push(`   - Excerpt: “${escapeInline(source.excerpt)}”`);
      }
    });
    lines.push('');
  }

  lines.push('## Verification', '');
  lines.push(
    `- ${audit.claims} claim${audit.claims === 1 ? '' : 's'} across ${audit.sources} source${audit.sources === 1 ? '' : 's'} and ${audit.distinctDomains} domain${audit.distinctDomains === 1 ? '' : 's'}.`,
  );
  lines.push(
    `- Supported: ${audit.effective.supported} · Uncertain: ${audit.effective.uncertain} · Contradicted: ${audit.effective.contradicted} · Unsupported: ${audit.effective.unsupported}.`,
  );
  if (audit.uncitedSourceIds.length > 0) {
    lines.push(`- Recorded but uncited sources: ${audit.uncitedSourceIds.length}.`);
  }
  if (audit.issues.length > 0) {
    lines.push('- Open ledger issues:');
    for (const issue of audit.issues) {
      lines.push(`  - [${issue.severity}] ${issue.message}`);
    }
  } else {
    lines.push('- No open ledger issues.');
  }
  lines.push('');

  lines.push('## Limitations', '');
  lines.push(
    'This report records sources, excerpts and claims entered by the owner. Coderax has not fetched, summarised or independently verified the linked pages, and an absence of recorded contradictions is not evidence that none exist.',
    '',
  );

  return lines.join('\n');
}
