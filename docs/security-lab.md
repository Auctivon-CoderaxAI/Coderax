# Coderax Security Lab

An authorized security workspace inside Coderax: scoped engagements, passive and
approved active testing, evidence capture, findings triage and report export.
It is a workspace within Web/Chat, not a sixth product — the five-product rail
and launcher remain unchanged.

## Architecture

```
┌──────────── client/src/components/SecurityLab ────────────┐
│  Scope gate → Console → Findings | Evidence | Report      │
│  Job strip (live) · split console at ≥1440px              │
└───────────────────────────┬───────────────────────────────┘
                            │ /api/security (existing auth)
┌───────────────────────────▼───────────────────────────────┐
│  api/server/security/routes.js                            │
│  api/server/security/service.js                           │
└───────────────────────────┬───────────────────────────────┘
                            │
┌───────────────────────────▼───────────────────────────────┐
│  packages/security-lab-core                               │
│  scope · policy · findings · jobs · redact · report       │
└───────────────────────────┬───────────────────────────────┘
                            │ argv only, never a shell
┌───────────────────────────▼───────────────────────────────┐
│  Isolated runner (nmap, nuclei, semgrep, trivy, gitleaks, │
│  ZAP) — NOT PROVISIONED. Tools report unavailable.        │
└───────────────────────────────────────────────────────────┘
```

## Controls

| Control | Implementation |
| --- | --- |
| Written authorization | Stored attestation (who, when, statement) required before any run |
| Scope enforcement | Exact host, `*.wildcard` or CIDR; checked before depth |
| SSRF resistance | Loopback, private, link-local, CGNAT, multicast, IPv6 ULA, mapped-v6 all blocked |
| DNS rebinding | Resolution re-validated immediately before connect |
| Depth gating | passive → active_readonly → intrusive |
| Per-action approval | Single target, expiring, single use, for intrusive tools |
| Prohibited capabilities | Persistence, lateral movement, credential theft, phishing, DoS, destructive, evasion refused by name |
| Argument injection | argv arrays, `shell: false`, leading dash and metacharacters rejected |
| Untrusted output | Wrapped as `trust="untrusted"`, fence-breaking neutralised, injection flagged not obeyed |
| Secret hygiene | Bearer/JWT/AWS/GitHub keys and `password=` pairs redacted before logging or reporting |
| Tenant isolation | Engagement lookup scoped to the creating user; foreign ids return 404 |
| Time budget | Wall-clock cap with sweep to `timed_out`; monotonic progress |
| Concurrency | Start refused above `maxConcurrent` |
| Audit | `engagement.created`, `policy.decision`, `job.enqueued`, `job.cancelled`, `report.exported` |

## API

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/security/tools` | Availability is computed, never assumed |
| GET | `/api/security/engagements` | Current user only |
| POST | `/api/security/engagements` | Requires `authorized: true` |
| GET | `/api/security/engagements/:id` | Engagement, findings, jobs |
| POST | `/api/security/engagements/:id/runs` | Policy decision, then enqueue |
| POST | `/api/security/engagements/:id/approvals` | Intrusive actions |
| POST | `/api/security/engagements/:id/runs/:jobId/cancel` | Cancellation |
| GET | `/api/security/engagements/:id/report.md` | Markdown export |
| GET | `/api/security/engagements/:id/report.json` | JSON export |

## Testing

`packages/security-lab-core` has 23 tests that run with `node --test` and no
dependencies. They cover address classification, CIDR boundaries, credential and
path rejection in targets, missing attestations, private-address refusal,
rebinding re-validation, scope-before-resolution, depth gating, approval expiry
and target binding, lab-only exploit validation, workspace path escapes,
findings validation and dedupe, job transitions and timeouts, concurrency
limits, redaction, untrusted wrapping, argv construction and report export.

The client component, API router and service are **not** covered by those tests:
they require the monorepo build and a database, which this environment does not
have.

## Deployment requirements

1. A repository implementation for the `repo` interface (engagements, evidence,
   findings, approvals, audit).
2. A durable job store; the in-memory `JobStore` is a development default and
   loses state on restart.
3. An isolated worker with no host mounts, a read-only root, a CPU/memory cap,
   an egress allowlist and no credentials — one job per container.
4. Model routing unchanged: providers are the existing Coderax ones.

## Status

- Core policy, schemas, jobs, redaction and reports: **VERIFIED** by the test suite.
- API router and client UI: **IMPLEMENTED, NOT VERIFIED** — committed, never built or run.
- Active scanning: **BLOCKED** — no isolated runner is provisioned.
- Deployment: **BLOCKED** — no hosting credentials in this environment.
