# Cross-repository governance follow-up

Historical proposals: #336 and #338. Reconciled against Coderax main `7de9f64` on 2026-11-26.

## Verified source state

- Canonical Coderax repository ID 1418161086; current visibility public. Visibility is not changed by this PR. Owner-only application access, no public launch, and zero added cost remain required.
- Main already has a manifest-based `CI gate`, a review/rollback policy, and Redis relative TLS paths, loopback binding, protected mode and persistence settings. Preserve those.
- The Locize reviewer is corrected to the existing repository code owner.
- The proposed competing gate implementation from #338 is not installed wholesale. Keep the existing check name and manifest. The trusted base checkout is a targeted hardening change, not proof of organization-level enforcement.

## Outstanding audit and acceptance work

| Priority | Requirement | Status |
| --- | --- | --- |
| P0 | Verify exact-head passing and intentionally failing gates, wrong-head and wrong-PR evidence, skipped/cancelled runs, missing expected checks and API failures. Compare existing manifest coverage to the proposed path-filter gate. | Pending hosted validation |
| P0 | Prevent gate workflow self-weakening through independent code-owner review and a trusted required workflow where supported; confirm actual ruleset and administrator enforcement before making claims. | Unverified |
| P0 | Audit same-repository PR access to secret-bearing steps; use isolated protected environments and never execute untrusted PR code with production credentials. | Historical finding from #336; re-verify |
| P1 | Verify branch protection, secret scanning and push protection, actual hosted runs and environment permissions across verified repositories; inspect names only, never secret values. | Unverified |
| P1 | Ensure merge-group candidates are genuinely tested before enabling a queue; do not report success solely because component workflows did not start. | Not implemented |
| P1 | Review neutral/skipped handling and report-only lanes; do not remove existing protections until replacement equivalence is proven. | Pending |
| P1 | Restrict or rotate standing deployment smoke credentials; review privileged workflow_run retry logic and release workflows for untrusted checkout paths. | Historical finding; re-verify |
| P2 | Audit upstream funding/contribution links and verify repository ownership before repointing. | Historical finding; owner decision |

The other repositories, their visibility, branch rules, secret settings and CI conclusions have not been verified in this reconciliation. Do not infer public-source authorization, branch protection changes or secret-scanning status from older audit snapshots. Do not restore deleted starter/Helm workflows or bypass independent review. Execute checks using approved cloud resources only and do not incur new costs.
