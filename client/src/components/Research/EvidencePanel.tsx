import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { TResearchAudit } from 'coderax-data-provider';
import { ISSUE_LABEL_KEYS, NOT_READY_CLASS, READY_CLASS } from './labels';
import { useLocalize } from '~/hooks';

export default function EvidencePanel({ audit }: { audit: TResearchAudit }) {
  const localize = useLocalize();
  const errorCount = audit.issues.filter((issue) => issue.severity === 'error').length;
  const warningCount = audit.issues.length - errorCount;

  return (
    <section
      className="border-border-light bg-surface-secondary rounded-2xl border p-5"
      aria-labelledby="research-audit-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="research-audit-title" className="text-text-primary text-sm font-semibold">
            {localize('com_research_audit_title')}
          </h2>
          <p className="text-text-secondary mt-1 max-w-2xl text-sm leading-6">
            {localize('com_research_audit_subtitle')}
          </p>
        </div>
        <span className={audit.ready ? READY_CLASS : NOT_READY_CLASS} role="status">
          {audit.ready
            ? localize('com_research_audit_ready')
            : localize('com_research_audit_blocked')}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3 lg:grid-cols-6">
        <div>
          <dt className="text-text-tertiary">{localize('com_research_audit_sources')}</dt>
          <dd className="text-text-primary mt-0.5 text-base font-semibold">{audit.sources}</dd>
        </div>
        <div>
          <dt className="text-text-tertiary">{localize('com_research_audit_claims')}</dt>
          <dd className="text-text-primary mt-0.5 text-base font-semibold">{audit.claims}</dd>
        </div>
        <div>
          <dt className="text-text-tertiary">{localize('com_research_audit_domains')}</dt>
          <dd className="text-text-primary mt-0.5 text-base font-semibold">
            {audit.distinctDomains}
          </dd>
        </div>
        <div>
          <dt className="text-text-tertiary">{localize('com_research_audit_primary')}</dt>
          <dd className="text-text-primary mt-0.5 text-base font-semibold">
            {audit.primarySources}
          </dd>
        </div>
        <div>
          <dt className="text-text-tertiary">{localize('com_research_audit_unsupported')}</dt>
          <dd className="text-text-primary mt-0.5 text-base font-semibold">
            {audit.effective.unsupported}
          </dd>
        </div>
        <div>
          <dt className="text-text-tertiary">{localize('com_research_audit_contradicted')}</dt>
          <dd className="text-text-primary mt-0.5 text-base font-semibold">
            {audit.effective.contradicted}
          </dd>
        </div>
      </dl>

      {audit.issues.length === 0 ? (
        <p className="text-text-secondary mt-4 flex items-center gap-2 text-sm" role="status">
          <CheckCircle2 className="text-accent-primary size-4 shrink-0" aria-hidden="true" />
          {localize('com_research_audit_no_issues')}
        </p>
      ) : (
        <div className="mt-4">
          <p className="text-text-tertiary text-xs" role="status">
            {localize('com_research_audit_issue_count', {
              0: errorCount,
              1: warningCount,
            })}
          </p>
          <ul className="mt-2 space-y-1.5">
            {audit.issues.map((issue, index) => (
              <li
                key={`${issue.code}-${issue.claimId ?? issue.sourceId ?? index}`}
                className="text-text-secondary flex items-start gap-2 text-sm leading-6"
              >
                <AlertTriangle
                  className={
                    issue.severity === 'error'
                      ? 'text-text-destructive mt-1 size-3.5 shrink-0'
                      : 'text-text-tertiary mt-1 size-3.5 shrink-0'
                  }
                  aria-hidden="true"
                />
                <span>
                  <span className="sr-only">
                    {issue.severity === 'error'
                      ? localize('com_research_audit_severity_error')
                      : localize('com_research_audit_severity_warning')}
                    {': '}
                  </span>
                  {localize(ISSUE_LABEL_KEYS[issue.code])}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
