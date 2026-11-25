import type {
  TResearchAuditIssueCode,
  TResearchClaimStatus,
  TResearchEffectiveClaimStatus,
  TResearchProjectStatus,
  TResearchSourceKind,
} from 'coderax-data-provider';
import type { TranslationKeys } from '~/hooks';

export const STATUS_LABEL_KEYS = {
  draft: 'com_research_status_draft',
  collecting: 'com_research_status_collecting',
  review: 'com_research_status_review',
  complete: 'com_research_status_complete',
} as const satisfies Record<TResearchProjectStatus, TranslationKeys>;

export const SOURCE_KIND_LABEL_KEYS = {
  primary: 'com_research_kind_primary',
  secondary: 'com_research_kind_secondary',
  opinion: 'com_research_kind_opinion',
} as const satisfies Record<TResearchSourceKind, TranslationKeys>;

export const CLAIM_STATUS_LABEL_KEYS = {
  supported: 'com_research_claim_status_supported',
  contradicted: 'com_research_claim_status_contradicted',
  uncertain: 'com_research_claim_status_uncertain',
} as const satisfies Record<TResearchClaimStatus, TranslationKeys>;

export const EFFECTIVE_STATUS_LABEL_KEYS = {
  supported: 'com_research_effective_supported',
  contradicted: 'com_research_effective_contradicted',
  uncertain: 'com_research_effective_uncertain',
  unsupported: 'com_research_effective_unsupported',
} as const satisfies Record<TResearchEffectiveClaimStatus, TranslationKeys>;

export const ISSUE_LABEL_KEYS = {
  NO_SOURCES: 'com_research_issue_no_sources',
  NO_CLAIMS: 'com_research_issue_no_claims',
  CLAIM_WITHOUT_SOURCE: 'com_research_issue_claim_without_source',
  CITATION_UNKNOWN_SOURCE: 'com_research_issue_citation_unknown_source',
  SOURCE_UNUSED: 'com_research_issue_source_unused',
  DUPLICATE_SOURCE_URL: 'com_research_issue_duplicate_source_url',
  CONTRADICTED_CLAIM: 'com_research_issue_contradicted_claim',
} as const satisfies Record<TResearchAuditIssueCode, TranslationKeys>;

/** Semantic tone per effective status; no raw palette utilities. */
export const EFFECTIVE_STATUS_CLASS = {
  supported: 'border-accent-primary/30 bg-accent-primary/10 text-accent-primary',
  contradicted: 'border-border-heavy bg-surface-tertiary text-text-primary',
  uncertain: 'border-border-light bg-surface-tertiary text-text-secondary',
  unsupported: 'border-border-light bg-surface-primary text-text-tertiary',
} as const satisfies Record<TResearchEffectiveClaimStatus, string>;

export const READY_CLASS =
  'border-accent-primary/30 bg-accent-primary/10 text-accent-primary rounded-full border px-2 py-0.5 text-xs font-medium';
export const NOT_READY_CLASS =
  'border-border-light bg-surface-tertiary text-text-secondary rounded-full border px-2 py-0.5 text-xs font-medium';
