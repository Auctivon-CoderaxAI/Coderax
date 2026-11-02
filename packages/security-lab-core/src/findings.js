import { createHash } from 'node:crypto';
import { sanitizeText } from './redact.js';

export const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'];
const RANK = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

export class FindingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FindingError';
    this.code = code;
  }
}

export function severityFromCvss(score) {
  const n = Number(score);
  if (!Number.isFinite(n) || n < 0 || n > 10) throw new FindingError('invalid_cvss', `CVSS out of range: ${score}`);
  if (n === 0) return 'info';
  if (n < 4) return 'low';
  if (n < 7) return 'medium';
  if (n < 9) return 'high';
  return 'critical';
}

export function findingFingerprint({ toolId, target, title, location }) {
  return createHash('sha256')
    .update([toolId ?? '', target ?? '', title ?? '', location ?? ''].join('\u0000'))
    .digest('hex')
    .slice(0, 16);
}

export function validateFinding(finding = {}) {
  if (typeof finding.title !== 'string' || !finding.title.trim()) {
    throw new FindingError('missing_title', 'A finding needs a title');
  }
  if (!SEVERITIES.includes(finding.severity)) {
    throw new FindingError('invalid_severity', `Unknown severity: ${finding.severity}`);
  }
  if (!Array.isArray(finding.evidenceIds) || finding.evidenceIds.length === 0) {
    throw new FindingError('missing_evidence', 'A finding must cite at least one evidence record');
  }
  if (finding.cwe != null && !/^CWE-\d+$/.test(String(finding.cwe))) {
    throw new FindingError('invalid_cwe', `Bad CWE identifier: ${finding.cwe}`);
  }
  if (finding.cve != null && !/^CVE-\d{4}-\d{4,}$/.test(String(finding.cve))) {
    throw new FindingError('invalid_cve', `Bad CVE identifier: ${finding.cve}`);
  }
  return true;
}

export function createFinding(input = {}, now = Date.now()) {
  const finding = {
    id: input.id ?? `f_${now.toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
    title: sanitizeText(String(input.title ?? '').trim()),
    severity: input.severity,
    status: input.status ?? 'open',
    target: input.target ?? null,
    location: input.location ?? null,
    toolId: input.toolId ?? null,
    evidenceIds: Array.isArray(input.evidenceIds) ? [...input.evidenceIds] : [],
    cwe: input.cwe ?? null,
    cve: input.cve ?? null,
    cvss: input.cvss ?? null,
    summary: sanitizeText(input.summary ?? ''),
    remediation: sanitizeText(input.remediation ?? ''),
    references: Array.isArray(input.references) ? input.references.map((r) => sanitizeText(String(r))) : [],
    createdAt: new Date(now).toISOString(),
    confidence: input.confidence ?? 'medium',
  };
  validateFinding(finding);
  finding.fingerprint = findingFingerprint(finding);
  return finding;
}

export function dedupeFindings(findings = []) {
  const seen = new Map();
  for (const f of findings) {
    const key = f.fingerprint ?? findingFingerprint(f);
    if (!seen.has(key)) {
      seen.set(key, { ...f, duplicates: [] });
    } else {
      const kept = seen.get(key);
      kept.duplicates.push({ toolId: f.toolId, id: f.id });
      if (RANK[f.severity] > RANK[kept.severity]) kept.severity = f.severity;
    }
  }
  return [...seen.values()];
}

export function summarizeFindings(findings = []) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) {
    if (counts[f.severity] === undefined) continue;
    counts[f.severity] += 1;
  }
  const open = findings.filter((f) => f.status !== 'resolved').length;
  return { counts, total: findings.length, open };
}

export function sortBySeverity(findings = []) {
  return [...findings].sort((a, b) => (RANK[b.severity] ?? 0) - (RANK[a.severity] ?? 0));
}
