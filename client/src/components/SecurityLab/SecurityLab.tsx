import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * Security Lab workspace — approved hybrid:
 *   Option 3 (scope gate) → Option 1 (console) → Option 4 (findings)
 *   Option 2 (split console) at >= 1440px, Option 5 job strip throughout.
 *
 * Deliberately dependency-free: plain fetch + Tailwind utilities, so it drops
 * into the existing client without new packages.
 *
 * NOTE: this file has not been typechecked or built — the monorepo is not
 * checked out in the environment where it was authored.
 */

type Tool = {
  id: string;
  name: string;
  description: string;
  capability: string;
  available: boolean;
  reason: string | null;
};

type Finding = {
  id: string;
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  target: string | null;
  cwe: string | null;
  cve: string | null;
  remediation: string;
  evidenceIds: string[];
};

type Job = { id: string; toolId: string; target: string | null; state: string; progress: number };

type Engagement = {
  id: string;
  name: string;
  depth: 'passive' | 'active_readonly' | 'intrusive';
  targets: string[];
  authorization: { attestedBy: string; attestedAt: string; statement: string };
};

const SEV: Record<Finding['severity'], string> = {
  critical: 'bg-red-500/15 text-red-600 dark:text-red-300',
  high: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  medium: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-200',
  low: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  info: 'bg-gray-500/15 text-gray-600 dark:text-gray-300',
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/security${path}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(body?.error ?? `Request failed (${res.status})`);
    (error as Error & { code?: string }).code = body?.code;
    throw error;
  }
  return body as T;
}

export default function SecurityLab() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [engagement, setEngagement] = useState<Engagement | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [tab, setTab] = useState<'evidence' | 'findings' | 'report'>('evidence');
  const [wide, setWide] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1440px)');
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  useEffect(() => {
    api<{ tools: Tool[] }>('/tools').then((r) => setTools(r.tools)).catch(() => setTools([]));
  }, []);

  const refresh = useCallback(async (id: string) => {
    const data = await api<{ engagement: Engagement; findings: Finding[]; jobs: Job[] }>(`/engagements/${id}`);
    setEngagement(data.engagement);
    setFindings(data.findings);
    setJobs(data.jobs);
  }, []);

  useEffect(() => {
    if (!engagement) return undefined;
    const timer = window.setInterval(() => {
      refresh(engagement.id).catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [engagement, refresh]);

  const summary = useMemo(() => {
    const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const f of findings) counts[f.severity] += 1;
    return counts;
  }, [findings]);

  if (!engagement) {
    return (
      <ScopeGate
        tools={tools}
        error={error}
        onCreate={async (payload) => {
          try {
            const res = await api<{ engagement: Engagement }>('/engagements', {
              method: 'POST',
              body: JSON.stringify(payload),
            });
            setEngagement(res.engagement);
            setError(null);
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-white text-gray-900 dark:bg-[#171718] dark:text-gray-100">
      <header className="flex items-center gap-3 border-b border-black/10 px-4 py-2.5 dark:border-white/10">
        <span className="text-sm font-semibold">Security Lab</span>
        <span className="text-xs text-gray-500">{engagement.name}</span>
        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
          Authorized
        </span>
        <span className="ml-auto font-mono text-[11px] text-gray-500">{engagement.targets.join(' · ')}</span>
      </header>

      <div className={`flex min-h-0 flex-1 ${wide ? 'flex-row' : 'flex-col'}`}>
        <section className={`flex min-h-0 flex-1 flex-col ${wide ? 'border-r border-black/10 dark:border-white/10' : ''}`}>
          <ChatPane engagement={engagement} tools={tools} onRan={() => refresh(engagement.id)} />
        </section>

        <aside className={`flex min-h-0 flex-col ${wide ? 'w-[420px]' : 'border-t border-black/10 dark:border-white/10'}`}>
          <div className="flex gap-1 border-b border-black/10 px-2 py-1.5 text-xs dark:border-white/10">
            {(['evidence', 'findings', 'report'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                aria-pressed={tab === t}
                className={`rounded-md px-2.5 py-1 capitalize ${tab === t ? 'bg-teal-600/15 font-semibold text-teal-800 dark:text-teal-200' : 'text-gray-500 hover:bg-black/5 dark:hover:bg-white/5'}`}
              >
                {t}
                {t === 'findings' && findings.length > 0 ? ` ${findings.length}` : ''}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-3">
            {tab === 'findings' && <FindingsBoard findings={findings} summary={summary} />}
            {tab === 'evidence' && <EvidenceList jobs={jobs} />}
            {tab === 'report' && <ReportPane engagementId={engagement.id} />}
          </div>
        </aside>
      </div>

      <JobStrip jobs={jobs} wide={wide} />
    </div>
  );
}

function ScopeGate({ tools, onCreate, error }: {
  tools: Tool[];
  error: string | null;
  onCreate: (payload: { name: string; targets: string[]; depth: string; authorized: boolean }) => void;
}) {
  const [name, setName] = useState('');
  const [targets, setTargets] = useState('');
  const [depth, setDepth] = useState<'passive' | 'active_readonly' | 'intrusive'>('active_readonly');
  const [attested, setAttested] = useState(false);

  const parsed = targets.split(/[\s,]+/).filter(Boolean);

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col gap-4 overflow-auto p-6">
      <div>
        <h1 className="text-lg font-semibold">New engagement</h1>
        <p className="text-xs text-gray-500">Authorization is recorded before any tool can run.</p>
      </div>

      <label className="text-xs font-medium text-gray-600 dark:text-gray-300">
        Engagement name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/15"
          placeholder="acme-labs web app"
        />
      </label>

      <label className="text-xs font-medium text-gray-600 dark:text-gray-300">
        Targets — one per line (host, IP or CIDR)
        <textarea
          value={targets}
          onChange={(e) => setTargets(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 font-mono text-sm dark:border-white/15"
          placeholder={'app.example.com\n203.0.113.0/28'}
        />
      </label>

      <fieldset>
        <legend className="mb-1 text-xs font-medium text-gray-600 dark:text-gray-300">Depth</legend>
        <div className="flex flex-wrap gap-2">
          {(['passive', 'active_readonly', 'intrusive'] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDepth(d)}
              aria-pressed={depth === d}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${depth === d ? 'bg-teal-600/15 text-teal-800 ring-1 ring-teal-600/40 dark:text-teal-200' : 'bg-black/5 text-gray-600 dark:bg-white/5 dark:text-gray-300'}`}
            >
              {d.replace('_', ' ')}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-gray-500">
          Intrusive actions also need a per-action approval. Egress is allowlisted, timeouts are 90s.
        </p>
      </fieldset>

      <label className="flex items-start gap-2 rounded-lg bg-teal-600/10 p-3 text-xs">
        <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} className="mt-0.5" />
        <span>I own or am authorized in writing to test these targets.</span>
      </label>

      <div className="text-[11px] text-gray-500">
        {tools.filter((t) => t.available).length} of {tools.length} tools available in this environment.
      </div>

      {error && <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">{error}</p>}

      <button
        type="button"
        disabled={!attested || parsed.length === 0}
        onClick={() => onCreate({ name: name || 'engagement', targets: parsed, depth, authorized: true })}
        className="rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
      >
        Start engagement
      </button>
    </div>
  );
}

function ChatPane({ engagement, tools, onRan }: { engagement: Engagement; tools: Tool[]; onRan: () => void }) {
  const [target, setTarget] = useState(engagement.targets[0] ?? '');
  const [toolId, setToolId] = useState(tools.find((t) => t.available)?.id ?? 'dns.lookup');
  const [message, setMessage] = useState<string | null>(null);

  const available = tools.filter((t) => t.available);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-auto p-4 text-sm">
        <p className="mb-3 max-w-prose text-gray-600 dark:text-gray-300">
          Scope recorded for {engagement.targets.length} target(s) at depth {engagement.depth}.
          Ask about a finding, request a passive check, or open the console.
        </p>
        {message && (
          <p role="status" className="rounded-lg bg-black/5 px-3 py-2 font-mono text-xs dark:bg-white/5">
            {message}
          </p>
        )}
      </div>

      <div className="border-t border-black/10 p-3 dark:border-white/10">
        <div className="mb-2 flex flex-wrap gap-2">
          <input
            aria-label="Target"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="min-w-[12rem] flex-1 rounded-lg border border-black/10 bg-transparent px-2.5 py-1.5 font-mono text-xs dark:border-white/15"
          />
          <select
            aria-label="Tool"
            value={toolId}
            onChange={(e) => setToolId(e.target.value)}
            className="rounded-lg border border-black/10 bg-transparent px-2 py-1.5 text-xs dark:border-white/15"
          >
            {available.map((t) => (
              <option key={t.id} value={t.id} className="text-black">
                {t.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={async () => {
              try {
                await api(`/engagements/${engagement.id}/runs`, {
                  method: 'POST',
                  body: JSON.stringify({ toolId, target }),
                });
                setMessage(`${toolId} queued for ${target}`);
                onRan();
              } catch (e) {
                setMessage((e as Error).message);
              }
            }}
            className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white"
          >
            Run
          </button>
        </div>
        <p className="text-[11px] text-gray-500">
          Chat · Work · <strong>Lab</strong> — the model selector and thinking effort are unchanged.
        </p>
      </div>
    </div>
  );
}

function FindingsBoard({ findings, summary }: { findings: Finding[]; summary: Record<string, number> }) {
  if (findings.length === 0) {
    return <p className="text-xs text-gray-500">No findings yet. Suppressed and duplicate issues are merged here.</p>;
  }
  return (
    <div className="space-y-2">
      <div className="flex gap-1.5 text-[10px] font-semibold uppercase tracking-wide">
        {(['critical', 'high', 'medium', 'low'] as const).map((s) => (
          <span key={s} className={`rounded px-1.5 py-0.5 ${SEV[s]}`}>
            {s} {summary[s]}
          </span>
        ))}
      </div>
      {findings.map((f) => (
        <article key={f.id} className="rounded-lg border border-black/10 p-2.5 dark:border-white/10">
          <div className="flex items-start gap-2">
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${SEV[f.severity]}`}>{f.severity}</span>
            <h3 className="text-xs font-semibold">{f.title}</h3>
          </div>
          <p className="mt-1 font-mono text-[11px] text-gray-500">
            {f.target ?? '—'}
            {f.cwe ? ` · ${f.cwe}` : ''}
            {f.cve ? ` · ${f.cve}` : ''}
          </p>
          {f.remediation && <p className="mt-1 text-[11px] text-gray-600 dark:text-gray-300">{f.remediation}</p>}
        </article>
      ))}
    </div>
  );
}

function EvidenceList({ jobs }: { jobs: Job[] }) {
  if (jobs.length === 0) return <p className="text-xs text-gray-500">No jobs have run in this engagement.</p>;
  return (
    <ul className="space-y-2">
      {jobs.map((j) => (
        <li key={j.id} className="rounded-lg border border-black/10 p-2.5 text-xs dark:border-white/10">
          <div className="flex items-center justify-between font-mono">
            <span>{j.toolId}</span>
            <span className="text-gray-500">{j.state}</span>
          </div>
          <p className="mt-0.5 font-mono text-[11px] text-gray-500">{j.target ?? 'workspace'}</p>
          {j.state === 'running' && (
            <div className="mt-1.5 h-1 overflow-hidden rounded bg-black/10 dark:bg-white/10">
              <div className="h-full bg-teal-600" style={{ width: `${Math.round(j.progress * 100)}%` }} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function ReportPane({ engagementId }: { engagementId: string }) {
  return (
    <div className="space-y-2 text-xs">
      <p className="text-gray-500">Exports include the authorization record, severity counts, findings and an evidence appendix.</p>
      <div className="flex gap-2">
        <a className="rounded-lg bg-teal-600 px-3 py-1.5 font-semibold text-white" href={`/api/security/engagements/${engagementId}/report.md`}>
          Download Markdown
        </a>
        <a className="rounded-lg border border-black/10 px-3 py-1.5 dark:border-white/15" href={`/api/security/engagements/${engagementId}/report.json`}>
          JSON
        </a>
      </div>
    </div>
  );
}

function JobStrip({ jobs, wide }: { jobs: Job[]; wide: boolean }) {
  const running = jobs.filter((j) => j.state === 'running');
  if (running.length === 0) return null;
  return (
    <div aria-live="polite" className="flex items-center gap-3 border-t border-black/10 px-4 py-1.5 text-[11px] dark:border-white/10">
      <span className="font-semibold text-teal-700 dark:text-teal-300">{running.length} running</span>
      {running.slice(0, wide ? 4 : 2).map((j) => (
        <span key={j.id} className="font-mono text-gray-500">
          {j.toolId} {Math.round(j.progress * 100)}%
        </span>
      ))}
    </div>
  );
}
