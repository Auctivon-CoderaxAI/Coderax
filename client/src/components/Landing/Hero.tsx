import { useState } from 'react';
import { hero, preview, thread } from './content';
import { Reveal, ButtonLink } from './primitives';

const kindStyles: Record<string, string> = {
  search: 'text-[#7c8a6a] dark:text-[#b6f24a]',
  read: 'text-[#5b6b8a] dark:text-[#9db8ff]',
  write: 'text-[#8a6a3f] dark:text-[#ffcf8a]',
  bash: 'text-[#4f7a5a] dark:text-[#8fe0a8]',
};

function Dot({ kind }: { kind: string }) {
  return (
    <span
      aria-hidden="true"
      className={`mt-[7px] inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
        kind === 'write' ? 'bg-[#b98a4a] dark:bg-[#ffcf8a]' : 'bg-[#8a9978] dark:bg-[#b6f24a]'
      }`}
    />
  );
}

function ThreadPanel() {
  return (
    <div className="grid gap-5 p-4 sm:grid-cols-[1.55fr_1fr] sm:p-5">
      <div className="rounded-xl border border-[#e4e7db] bg-white/60 p-3.5 dark:border-white/10 dark:bg-white/[0.03]">
        <div className="flex items-center justify-between gap-3 border-b border-[#eceee3] pb-3 dark:border-white/10">
          <div className="flex items-center gap-2">
            <span className="h-6 w-6 rounded-full bg-gradient-to-br from-[#b6f24a] to-[#5f8f2a]" />
            <span className="text-[12px] font-medium text-[#242a1c] dark:text-[#e8ece0]">{thread.agent}</span>
          </div>
          <span className="rounded-full bg-[#f2f4ea] px-2 py-0.5 font-mono text-[10px] text-[#5c6650] dark:bg-white/5 dark:text-[#9aa891]">
            {thread.workspace}
          </span>
        </div>
        <ol className="mt-3 space-y-3">
          {thread.steps.map((step) => (
            <li key={step.label} className="flex gap-2.5">
              <Dot kind={step.kind} />
              <div className="min-w-0">
                <p className={`text-[12px] font-medium ${kindStyles[step.kind] ?? ''}`}>{step.label}</p>
                <p className="mt-0.5 truncate font-mono text-[10.5px] text-[#6b7463] dark:text-[#8b9782]">
                  {step.detail}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
      <div className="rounded-xl border border-[#e4e7db] bg-white/60 p-3.5 dark:border-white/10 dark:bg-white/[0.03]">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7c8a6a] dark:text-[#8b9782]">
          Context usage
        </p>
        <div className="mt-3 space-y-2">
          {thread.usage.map((row) => (
            <div key={row.label}>
              <div className="flex items-center justify-between text-[11px] text-[#4d5545] dark:text-[#b6c1ac]">
                <span>{row.label}</span>
                <span className="font-mono text-[10px] text-[#7c8a6a] dark:text-[#8b9782]">{row.value}%</span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-[#e8ebdd] dark:bg-white/10">
                <div
                  className="h-full rounded-full bg-[#7c8a6a] dark:bg-[#b6f24a]"
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
      <div className="rounded-xl border border-[#e0d7c3] bg-[#fdf8ee] p-4 dark:border-[#3a3325] dark:bg-[#171410]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8a6a3f] dark:text-[#ffcf8a]">
          Approval required
        </p>
        <p className="mt-2 text-[13px] text-[#2b2519] dark:text-[#efe6d6]">
          The agent wants to write{' '}
          <span className="font-mono text-[12px]">client/src/routes/useAuthRedirect.ts</span> and run{' '}
          <span className="font-mono text-[12px]">bun run typecheck</span>.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="rounded-full bg-[#16180f] px-3 py-1.5 text-[12px] font-medium text-[#f4f6ef] dark:bg-[#b6f24a] dark:text-[#0c0e08]">
            Allow
          </span>
          <span className="rounded-full border border-[#d8dccd] px-3 py-1.5 text-[12px] font-medium text-[#4d5545] dark:border-white/15 dark:text-[#c2ccb7]">
            Ask
          </span>
          <span className="rounded-full border border-[#d8dccd] px-3 py-1.5 text-[12px] font-medium text-[#4d5545] dark:border-white/15 dark:text-[#c2ccb7]">
            Deny
          </span>
        </div>
      </div>
      <p className="mt-3 text-[11.5px] leading-relaxed text-[#6b7463] dark:text-[#8b9782]">
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
      <div className="overflow-hidden rounded-xl border border-[#e4e7db] dark:border-white/10">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="bg-[#f7f8f1] text-[10px] uppercase tracking-[0.12em] text-[#7c8a6a] dark:bg-white/[0.04] dark:text-[#8b9782]">
              <th scope="col" className="px-3 py-2 font-semibold">Round</th>
              <th scope="col" className="px-3 py-2 font-semibold">Detail</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-t border-[#eceee3] text-[11.5px] dark:border-white/10">
                <td className="px-3 py-2 font-mono text-[#242a1c] dark:text-[#e8ece0]">{row.label}</td>
                <td className="px-3 py-2 text-[#5c6650] dark:text-[#a9b3a0]">{row.detail}</td>
                <td className="px-3 py-2 text-right font-mono text-[#7c8a6a] dark:text-[#b6f24a]">{row.cost}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11.5px] text-[#6b7463] dark:text-[#8b9782]">
        Sample rows, shown to illustrate the Trace viewer layout.
      </p>
    </div>
  );
}

function PreviewCard() {
  const [active, setActive] = useState(preview.tabs[0].key);
  const current = preview.tabs.find((tab) => tab.key === active) ?? preview.tabs[0];

  return (
    <div className="overflow-hidden rounded-2xl border border-[#e4e7db] bg-[#fbfcf7] shadow-[0_1px_0_rgba(255,255,255,0.6)_inset,0_30px_80px_-40px_rgba(18,20,15,0.45)] dark:border-white/10 dark:bg-[#0b0d0c] dark:shadow-[0_1px_0_rgba(255,255,255,0.06)_inset,0_40px_120px_-50px_rgba(0,0,0,0.9)]">
      <div className="flex items-center gap-2 border-b border-[#e4e7db] px-4 py-2.5 dark:border-white/10">
        <span className="h-2 w-2 rounded-full bg-[#d8dccd] dark:bg-white/15" />
        <span className="h-2 w-2 rounded-full bg-[#d8dccd] dark:bg-white/15" />
        <span className="h-2 w-2 rounded-full bg-[#d8dccd] dark:bg-white/15" />
        <span className="ml-2 font-mono text-[10.5px] text-[#7c8a6a] dark:text-[#8b9782]">coderax / agents / release-agent</span>
      </div>

      <div className="flex flex-wrap items-center gap-1 border-b border-[#e4e7db] px-3 py-2 dark:border-white/10" role="tablist" aria-label="Product surfaces">
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
              className={`rounded-full px-3 py-1.5 text-[11.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7c8a6a] dark:focus-visible:ring-[#b6f24a] ${
                selected
                  ? 'bg-[#16180f] text-[#f4f6ef] dark:bg-[#b6f24a] dark:text-[#0c0e08]'
                  : 'text-[#5c6650] hover:bg-[#f0f2e8] dark:text-[#a9b3a0] dark:hover:bg-white/5'
              }`}
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

      <div className="border-t border-[#e4e7db] px-4 py-3 dark:border-white/10">
        <p className="text-[12px] font-medium text-[#242a1c] dark:text-[#e8ece0]">{current.title}</p>
        <p className="mt-1 text-[11.5px] leading-relaxed text-[#5c6650] dark:text-[#98a38f]">{current.description}</p>
      </div>
    </div>
  );
}

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-40 h-[520px] bg-[radial-gradient(60%_60%_at_50%_40%,rgba(182,242,74,0.16),transparent_70%)] dark:bg-[radial-gradient(60%_60%_at_50%_40%,rgba(182,242,74,0.13),transparent_72%)]"
      />
      <div className="relative mx-auto w-full max-w-6xl px-5 pb-16 pt-14 sm:px-8 sm:pt-20">
        <Reveal>
          <p className="inline-flex items-center gap-2 rounded-full border border-[#d8dccd] bg-white/70 px-3 py-1 text-[11px] font-medium text-[#5c6650] dark:border-white/12 dark:bg-white/[0.04] dark:text-[#b6c1ac]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#8fbf3f] dark:bg-[#b6f24a]" aria-hidden="true" />
            {hero.eyebrow}
          </p>
        </Reveal>

        <Reveal delay={60}>
          <h1 className="mt-6 max-w-3xl text-balance text-[clamp(2.25rem,5.4vw,4rem)] font-medium leading-[1.02] tracking-[-0.045em] text-[#12140f] dark:text-[#f4f6ef]">
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
                      className="absolute inset-x-0 bottom-[0.1em] z-0 h-[0.34em] bg-[#b6f24a]/45 dark:bg-[#b6f24a]/30"
                    />
                  </span>
                ) : null}
              </span>
            ))}
          </h1>
        </Reveal>

        <Reveal delay={120}>
          <p className="mt-5 max-w-xl text-pretty text-[15px] leading-relaxed text-[#4d5545] dark:text-[#a9b3a0]">
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
              <li key={item} className="flex items-center gap-2 text-[12px] text-[#6b7463] dark:text-[#8b9782]">
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
          <p className="mt-3 text-[11.5px] text-[#7c8a6a] dark:text-[#8b9782]">{preview.caption}</p>
        </Reveal>
      </div>
    </section>
  );
}
