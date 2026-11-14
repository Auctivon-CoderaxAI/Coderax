import { useState } from 'react';
import { clsx } from 'clsx';
import { hero, preview, thread } from './content';
import { Reveal, ButtonLink, focusRing } from './primitives';

const kindStyles: Record<string, string> = {
  search: 'text-series-3',
  read: 'text-series-1',
  write: 'text-series-4',
  bash: 'text-status-success',
};

function Dot({ kind }: { kind: string }) {
  return (
    <span
      aria-hidden="true"
      className={clsx(
        'mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full',
        kind === 'write' ? 'bg-series-4' : 'bg-accent-primary',
      )}
    />
  );
}

function ThreadPanel() {
  return (
    <div className="grid gap-5 p-4 sm:grid-cols-[1.55fr_1fr] sm:p-5">
      <div className="rounded-xl border border-border-light bg-surface-card p-3.5">
        <div className="flex items-center justify-between gap-3 border-b border-border-light pb-3">
          <div className="flex items-center gap-2">
            <span className="h-6 w-6 rounded-full bg-gradient-to-br from-accent-primary to-status-success" />
            <span className="text-xs font-medium text-text-primary">{thread.agent}</span>
          </div>
          <span className="rounded-full bg-surface-tertiary px-2 py-0.5 font-mono text-xs text-text-secondary">
            {thread.workspace}
          </span>
        </div>
        <ol className="mt-3 space-y-3">
          {thread.steps.map((step) => (
            <li key={step.label} className="flex gap-2.5">
              <Dot kind={step.kind} />
              <div className="min-w-0">
                <p className={clsx('text-xs font-medium', kindStyles[step.kind])}>{step.label}</p>
                <p className="mt-0.5 truncate font-mono text-xs text-text-tertiary">
                  {step.detail}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
      <div className="rounded-xl border border-border-light bg-surface-card p-3.5">
        <p className="text-xs font-semibold uppercase tracking-widest text-text-tertiary">
          Context usage
        </p>
        <div className="mt-3 space-y-2">
          {thread.usage.map((row) => (
            <div key={row.label}>
              <div className="flex items-center justify-between text-xs text-text-secondary">
                <span>{row.label}</span>
                <span className="font-mono text-xs text-text-tertiary">{row.value}%</span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-tertiary">
                <div
                  className="h-full rounded-full bg-accent-primary"
                  style={{ width: `${row.value}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ApprovalPanel() {
  return (
    <div className="p-4 sm:p-5">
      <div className="rounded-xl border border-status-warning-border bg-status-warning-subtle p-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-text-warning">
          Approval required
        </p>
        <p className="mt-2 text-sm text-text-primary">
          The agent wants to write{' '}
          <span className="font-mono text-xs">client/src/routes/useAuthRedirect.ts</span> and run{' '}
          <span className="font-mono text-xs">bun run typecheck</span>.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="rounded-full bg-button-primary px-3 py-1.5 text-xs font-medium text-text-inverted">
            Allow
          </span>
          <span className="rounded-full border border-border-medium px-3 py-1.5 text-xs font-medium text-text-secondary">
            Ask
          </span>
          <span className="rounded-full border border-border-medium px-3 py-1.5 text-xs font-medium text-text-secondary">
            Deny
          </span>
        </div>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-text-tertiary">
        Policies are per deployment and per Agent. The prompt is illustrative of the Ask state; the buttons above are
        not wired to a live deployment.
      </p>
    </div>
  );
}

function TracePanel() {
  const rows = [
    { label: 'model.turn 1', detail: 'responses · 1.2s · 3 tool calls', cost: '$0.0041' },
    { label: 'tool.bash', detail: 'bun run typecheck · exit 0', cost: '—' },
    { label: 'model.turn 2', detail: 'responses · 0.8s · 1 tool call', cost: '$0.0022' },
    { label: 'tool.write', detail: 'useAuthRedirect.ts · approved', cost: '—' },
  ];
  return (
    <div className="p-4 sm:p-5">
      <div className="overflow-hidden rounded-xl border border-border-light">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="bg-surface-secondary text-xs uppercase tracking-wider text-text-tertiary">
              <th scope="col" className="px-3 py-2 font-semibold">Round</th>
              <th scope="col" className="px-3 py-2 font-semibold">Detail</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-t border-border-light text-xs">
                <td className="px-3 py-2 font-mono text-text-primary">{row.label}</td>
                <td className="px-3 py-2 text-text-secondary">{row.detail}</td>
                <td className="px-3 py-2 text-right font-mono text-accent-primary">{row.cost}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-text-tertiary">
        Sample rows, shown to illustrate the Trace viewer layout.
      </p>
    </div>
  );
}

function PreviewCard() {
  const [active, setActive] = useState(preview.tabs[0].key);
  const current = preview.tabs.find((tab) => tab.key === active) ?? preview.tabs[0];

  return (
    <div className="overflow-hidden rounded-2xl border border-border-light bg-surface-primary shadow-theme-surface">
      <div className="flex items-center gap-2 border-b border-border-light px-4 py-2.5">
        <span className="h-2 w-2 rounded-full bg-border-medium" />
        <span className="h-2 w-2 rounded-full bg-border-medium" />
        <span className="h-2 w-2 rounded-full bg-border-medium" />
        <span className="ml-2 font-mono text-xs text-text-tertiary">coderax / agents / release-agent</span>
      </div>

      <div className="flex flex-wrap items-center gap-1 border-b border-border-light px-3 py-2" role="tablist" aria-label="Product surfaces">
        {preview.tabs.map((tab) => {
          const selected = tab.key === active;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              id={`tab-${tab.key}`}
              aria-selected={selected}
              aria-controls={`panel-${tab.key}`}
              onClick={() => setActive(tab.key)}
              className={clsx(
                'rounded-full px-3 py-1.5 text-xs font-medium transition-colors touch:min-h-theme-control-touch',
                focusRing,
                selected
                  ? 'bg-button-primary text-text-inverted'
                  : 'text-text-secondary hover:bg-surface-hover',
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`panel-${active}`} aria-labelledby={`tab-${active}`}>
        {active === 'thread' ? <ThreadPanel /> : null}
        {active === 'approvals' ? <ApprovalPanel /> : null}
        {active === 'trace' ? <TracePanel /> : null}
      </div>

      <div className="border-t border-border-light px-4 py-3">
        <p className="text-xs font-medium text-text-primary">{current.title}</p>
        <p className="mt-1 text-xs leading-relaxed text-text-secondary">{current.description}</p>
      </div>
    </div>
  );
}

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-40 h-[520px] bg-radial from-accent-primary/15 to-transparent to-70%"
      />
      <div className="relative mx-auto w-full max-w-6xl px-5 pb-16 pt-14 sm:px-8 sm:pt-20">
        <Reveal>
          <p className="inline-flex items-center gap-2 rounded-full border border-border-medium bg-surface-card px-3 py-1 text-xs font-medium text-text-secondary">
            <span className="h-1.5 w-1.5 rounded-full bg-accent-primary" aria-hidden="true" />
            {hero.eyebrow}
          </p>
        </Reveal>

        <Reveal delay={60}>
          <h1 className="mt-6 max-w-3xl text-balance text-4xl font-medium leading-none tracking-tighter text-text-primary sm:text-5xl lg:text-6xl">
            {hero.title[0]}
            <br />
            {hero.title[1].split(hero.highlight).map((part, index, parts) => (
              <span key={`${part}-${index}`}>
                {part}
                {index < parts.length - 1 ? (
                  <span className="relative whitespace-nowrap">
                    <span className="relative z-10">{hero.highlight}</span>
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-0 bottom-[0.1em] z-0 h-[0.34em] bg-accent-primary/30"
                    />
                  </span>
                ) : null}
              </span>
            ))}
          </h1>
        </Reveal>

        <Reveal delay={120}>
          <p className="mt-5 max-w-xl text-pretty text-base leading-relaxed text-text-secondary">
            {hero.description}
          </p>
        </Reveal>

        <Reveal delay={180}>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <ButtonLink href={hero.primary.href}>{hero.primary.label}</ButtonLink>
            <ButtonLink href={hero.secondary.href} variant="ghost">
              {hero.secondary.label}
            </ButtonLink>
          </div>
        </Reveal>

        <Reveal delay={240}>
          <ul className="mt-8 flex flex-wrap gap-x-5 gap-y-2">
            {hero.meta.map((item) => (
              <li key={item} className="flex items-center gap-2 text-xs text-text-tertiary">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="m5 13 4 4L19 7" />
                </svg>
                {item}
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal delay={300} className="mt-12">
          <PreviewCard />
          <p className="mt-3 text-xs text-text-tertiary">{preview.caption}</p>
        </Reveal>
      </div>
    </section>
  );
}
