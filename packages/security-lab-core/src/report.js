import { redactSecrets, sanitizeText } from './redact.js';
import { sortBySeverity, summarizeFindings } from './findings.js';

const DISCLAIMER = [
  'This report was produced by Coderax Security Lab under a recorded authorization.',
  'Tool output is untrusted third-party data and is quoted as evidence only.',
  'Findings are observations, not proof of exploitability; validate before remediation sign-off.',
].join(' ');

function cell(value, max = 160) {
  const s = redactSecrets(String(value ?? '')).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s || '—';
}

function fence(text, lang = '') {
  const body = redactSecrets(text).replace(/```/g, '``\u200b`');
  return `\`\`\`${lang}\n${body}\n\`\`\``;
}

export function toMarkdown({ engagement = {}, findings = [], evidence = [], meta = {} } = {}) {
  const auth = engagement.authorization ?? {};
  const summary = summarizeFindings(findings);
  const ordered = sortBySeverity(findings);
  const lines = [];

  lines.push(`# Security report — ${cell(engagement.name ?? engagement.id ?? 'engagement', 80)}`);
  lines.push('');
  lines.push(`Generated ${new Date(meta.now ?? Date.now()).toISOString()} by Coderax Security Lab.`);
  lines.push('');
  lines.push('## Engagement');
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('| --- | --- |');
  lines.push(`| Engagement | ${cell(engagement.name ?? engagement.id)} |`);
  lines.push(`| Authorization basis | ${cell(auth.statement)} |`);
  lines.push(`| Attested by | ${cell(auth.attestedBy)} |`);
  lines.push(`| Attested at | ${cell(auth.attestedAt)} |`);
  lines.push(`| Depth | ${cell(engagement.depth)} |`);
  lines.push(`| Targets | ${cell((engagement.targets ?? []).map((t) => (typeof t === 'string' ? t : t.value)).join(', '), 400)} |`);
  lines.push('');

  lines.push('## Summary');
  lines.push('');
  lines.push('| Severity | Count |');
  lines.push('| --- | --- |');
  for (const sev of ['critical', 'high', 'medium', 'low', 'info']) {
    lines.push(`| ${sev} | ${summary.counts[sev]} |`);
  }
  lines.push(`| **total** | **${summary.total}** |`);
  lines.push('');

  lines.push('## Findings');
  lines.push('');
  if (ordered.length === 0) {
    lines.push('No findings were recorded for this engagement.');
    lines.push('');
  }
  ordered.forEach((f, i) => {
    lines.push(`### ${i + 1}. ${cell(f.title, 140)} (${f.severity})`);
    lines.push('');
    lines.push('| Field | Value |');
    lines.push('| --- | --- |');
    lines.push(`| Target | ${cell(f.target)} |`);
    lines.push(`| Location | ${cell(f.location)} |`);
    lines.push(`| Tool | ${cell(f.toolId)} |`);
    lines.push(`| Confidence | ${cell(f.confidence)} |`);
    if (f.cwe) lines.push(`| CWE | ${cell(f.cwe)} |`);
    if (f.cve) lines.push(`| CVE | ${cell(f.cve)} |`);
    if (f.cvss != null) lines.push(`| CVSS | ${cell(f.cvss)} |`);
    lines.push(`| Evidence | ${cell((f.evidenceIds ?? []).join(', '))} |`);
    lines.push('');
    if (f.summary) {
      lines.push('**Observation.**');
      lines.push('');
      lines.push(sanitizeText(f.summary).replace(/^/gm, '> '));
      lines.push('');
    }
    if (f.remediation) {
      lines.push('**Remediation.**');
      lines.push('');
      lines.push(sanitizeText(f.remediation).replace(/^/gm, '> '));
      lines.push('');
    }
    if (Array.isArray(f.references) && f.references.length) {
      lines.push('**References.**');
      lines.push('');
      for (const r of f.references) lines.push(`- ${cell(r, 300)}`);
      lines.push('');
    }
  });

  if (evidence.length) {
    lines.push('## Evidence appendix');
    lines.push('');
    lines.push('Output is reproduced verbatim, redacted for secrets, and is untrusted data.');
    lines.push('');
    for (const ev of evidence) {
      lines.push(`### ${cell(ev.id)} · ${cell(ev.toolId)} · ${cell(ev.target)}`);
      lines.push('');
      lines.push(fence(ev.output ?? '', ev.language ?? 'text'));
      lines.push('');
    }
  }

  lines.push('## Notes');
  lines.push('');
  lines.push(`> ${DISCLAIMER}`);
  lines.push('');
  return lines.join('\n');
}

export function toJson({ engagement = {}, findings = [], evidence = [], meta = {} } = {}) {
  return {
    schemaVersion: 1,
    generatedAt: new Date(meta.now ?? Date.now()).toISOString(),
    disclaimer: DISCLAIMER,
    engagement: {
      id: engagement.id ?? null,
      name: engagement.name ?? null,
      depth: engagement.depth ?? null,
      kind: engagement.kind ?? null,
      targets: (engagement.targets ?? []).map((t) => (typeof t === 'string' ? t : t.value)),
      authorization: {
        attestedBy: engagement.authorization?.attestedBy ?? null,
        attestedAt: engagement.authorization?.attestedAt ?? null,
        statement: engagement.authorization?.statement ?? null,
      },
    },
    summary: summarizeFindings(findings),
    findings: sortBySeverity(findings).map((f) => ({
      id: f.id,
      title: redactSecrets(f.title),
      severity: f.severity,
      status: f.status,
      target: f.target,
      location: f.location,
      cwe: f.cwe,
      cve: f.cve,
      cvss: f.cvss,
      remediation: redactSecrets(f.remediation),
      evidenceIds: f.evidenceIds,
    })),
    evidence: evidence.map((ev) => ({
      id: ev.id,
      toolId: ev.toolId,
      target: ev.target,
      output: redactSecrets(ev.output ?? ''),
    })),
  };
}
