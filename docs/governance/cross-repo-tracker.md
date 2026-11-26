# Cross-repository governance tracker

Owner: repository governance and CI. Updated 2026-11-26.

This page is the single status record for branch protection, the aggregate CI gate, the governance
bootstrap and the security posture across the three `Auctivon-CoderaxAI` repositories. A field marked
**owner-recorded** was not readable from this cloud session without an admin token; it is not a claim
that the value is absent or unsafe.

## Public visibility is intentional

All three repositories are **intentionally public**. Public visibility is what enables free
GitHub-hosted Actions minutes, branch protection, secret scanning and push protection at the $0
budget. Public **source** visibility is authorized.

That authorization does not extend to the running application or to data:

- No public sign-up, guest access or anonymous application session.
- No credential, token, private key, customer record or production dataset in a public repository,
  workflow log, artifact or job summary.
- The gate workflow uses the read-only `GITHUB_TOKEN` and **no repository secret**.
- Production deployment credentials remain scoped to `push`, `tag` or `workflow_dispatch`
  workflows, never to a pull-request-triggered job.

## Repositories

| Repository               | Visibility           | `main` SHA                                 | Hosted Actions | Secret scanning          | Push protection          |
| ------------------------ | -------------------- | ------------------------------------------ | -------------- | ------------------------ | ------------------------ |
| `Coderax`                | public (intentional) | `a5d237b0ff672356374849d565363955df69d298` | enabled        | enabled (owner-recorded) | enabled (owner-recorded) |
| `Coderax-WorkflowEngine` | public (intentional) | `808dfd3797f9b1d7647ebd14bd395806fc4ab9bd` | enabled        | enabled (owner-recorded) | enabled (owner-recorded) |
| `CoderaxCLI`             | public (intentional) | `1b7c8e0a429755502f7563b16a8a09db899452d8` | enabled        | enabled (owner-recorded) | enabled (owner-recorded) |

Organization plan: **free**, two members (`nnabdelshahid` admin, `AICoderax`). Public repositories
include branch protection, secret scanning and push protection at no cost. The unauthenticated
repository response does not expose `security_and_analysis`, so enablement is owner-recorded rather
than re-read here; do not disable either feature to work around a push.

## Branch protection

### Coderax

The public branch API confirms the required check; the remaining rows are owner-recorded and need an
admin read to re-verify.

| Rule                              | Value                               | Source            |
| --------------------------------- | ----------------------------------- | ----------------- |
| Protected                         | yes                                 | public branch API |
| Required check                    | `CI gate (aggregate)`               | public branch API |
| Required app                      | GitHub Actions, `app_id` 15368      | public branch API |
| Enforcement                       | everyone                            | public branch API |
| Strict / up-to-date head          | yes                                 | owner-recorded    |
| Required approving reviews        | 1                                   | owner-recorded    |
| Dismiss stale approvals           | yes                                 | owner-recorded    |
| Require approval of the last push | yes                                 | owner-recorded    |
| Code-owner review                 | no — sole code owner would deadlock | owner-recorded    |
| Conversation resolution           | yes                                 | owner-recorded    |
| Enforce for administrators        | yes                                 | owner-recorded    |
| Force pushes / deletion           | blocked                             | owner-recorded    |

`CI gate (aggregate)` is the **only** required check. Component workflows stay path-filtered and stay
individually visible; they are not required by name.

### Coderax-WorkflowEngine and CoderaxCLI

Both repositories already have one unfiltered workflow, so one required check can always report:
WorkflowEngine requires `verify`; CLI requires `test`. These are owner-recorded; re-read them with an
admin token before treating them as current.

## The aggregate gate

Implementation: [`.github/workflows/ci-gate.yml`](../../.github/workflows/ci-gate.yml),
[`.github/scripts/ci-gate.mjs`](../../.github/scripts/ci-gate.mjs),
[`.github/scripts/ci-gate.test.mjs`](../../.github/scripts/ci-gate.test.mjs). Design and operations:
[`ci-gate.md`](ci-gate.md).

The consolidated implementation in PR #314:

- runs on every pull request to `main` with no path filter;
- uses gate logic, tests and workflow filters from the **base** revision;
- evaluates the latest workflow-run attempt at the **exact head SHA**;
- fails on failure, cancellation, timeout, `action_required`, `startup_failure`, `stale`, `neutral`,
  `skipped` and a completed run with no conclusion;
- rejects an applicable workflow that never registers after the start grace;
- evaluates commit statuses at the same SHA;
- evaluates only base-revision workflows, so a pull request cannot add a required lane;
- excludes its own workflow, so it cannot deadlock on itself;
- follows pagination and never evaluates a failed or partial API read as an empty pass;
- fails closed on `merge_group` unless every component declares that trigger;
- requires an owner approval at the exact head when an external contributor changes the CI control
  plane that judges their pull request.

PR #317's separate gate was not adopted: its job was named `CI gate`, which does not satisfy the
required `CI gate (aggregate)` context, and its curated `reportOnly` manifest would let a failing test
lane pass. The Redis and locize fixes from `governance/ci-gate-and-security` were reconciled into
PR #314; its `merge_group` success path and its treatment of `skipped`/`neutral` as passing were not.

## Bootstrap state

Branch protection **already requires** `CI gate (aggregate)` while the workflow exists only in the
bootstrap pull request (#314). This is the intended fail-closed state, not a reason to relax the rule.

| Step                                                           | State                                                                                                             |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Required check registered before the workflow exists on `main` | yes — verified in the public branch API                                                                           |
| Bootstrap pull request carrying the workflow                   | #314                                                                                                              |
| Bootstrap run uses the pull request's gate copy                | yes — base has no gate; owner author only; warned and manually reviewable                                         |
| Trusted base copy used after merge                             | yes — fallback requires the base to have **neither** workflow nor script                                          |
| Post-merge installation verification                           | `CI gate (installation)` runs on `push` to `main`, self-tests the gate and asserts no path filter + `merge_group` |
| Other open pull requests                                       | blocked until they update from `main`; that is fail-closed                                                        |

Do not merge #314 on the strength of the bootstrap run alone. Review the bootstrap copy and the job
summary, confirm the required check is green at the exact head, and keep the independent-approval and
administrator-enforcement rules unchanged.

## Open pull requests

Head SHAs move; re-read them before acting.

| PR                                                             | Title                                                                  | Head        | Governance state                                                                                                                |
| -------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [#314](https://github.com/Auctivon-CoderaxAI/Coderax/pull/314) | `ci: aggregate required CI gate and remove credential-shaped fixtures` | this branch | **Authoritative container.** Consolidated gate, Redis persistence, locize reviewer fix, docs.                                   |
| [#317](https://github.com/Auctivon-CoderaxAI/Coderax/pull/317) | `ci: one always-on gate instead of required checks that never run`     | `6a6ee0bd`  | Superseded by #314. Its check name does not match the required context; report-only lanes not adopted. Close after #314 merges. |
| [#312](https://github.com/Auctivon-CoderaxAI/Coderax/pull/312) | `test(ci): capture Chat and Work evidence on hosted runners`           | `ef518c42`  | Not governance. Blocked until it updates from `main` after #314.                                                                |
| [#313](https://github.com/Auctivon-CoderaxAI/Coderax/pull/313) | `fix(ui): fit Work composer controls`                                  | `93eaa5f5`  | Not governance. Blocked until it updates from `main` after #314.                                                                |
| [#316](https://github.com/Auctivon-CoderaxAI/Coderax/pull/316) | `fix(ci): make the UI evidence lane produce the artifacts it claims`   | `d44fde91`  | Separate evidence-lane repair; not part of the aggregate gate.                                                                  |
| [#310](https://github.com/Auctivon-CoderaxAI/Coderax/pull/310) | Dependabot i18next bump                                                | `777c3f7f`  | Dependency update; subject to the same gate.                                                                                    |

## Security posture

### Fixed or verified

| Item                                                                          | State                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Credential-shaped fixtures (`ghp_…`, `AKIA…`, private-key-like test literals) | Removed in PR #314 by assembling them at runtime. Redaction tests still exercise the real formats.                                                                                                                                       |
| Gate workflow permissions                                                     | Read-only `contents`, `actions`, `statuses`, `pull-requests`; no secrets; no `checks: write`.                                                                                                                                            |
| `pull_request_target`                                                         | Not used.                                                                                                                                                                                                                                |
| Gate self-deadlock                                                            | Own workflow path excluded; verified by test.                                                                                                                                                                                            |
| Merge-group false pass                                                        | Removed. The gate fails closed until component workflows declare `merge_group` and the candidate is genuinely verified.                                                                                                                  |
| Skipped/neutral masking                                                       | Removed. Only `success` passes.                                                                                                                                                                                                          |
| Stale/unrelated results                                                       | Latest attempt at the exact head only; wrong SHA, event, repository or pull request is rejected.                                                                                                                                         |
| Redis persistence                                                             | Preserved: `save 900 1`, `save 300 10`, `save 60 10000`, `stop-writes-on-bgsave-error`, `rdbcompression`, `rdbchecksum`, `dbfilename`, `dir`. The TLS path fix only rewrites certificate locations and the launcher's working directory. |
| Personal absolute TLS paths                                                   | Removed; certificate paths resolve beside `redis-config/`, and the launcher changes into that directory.                                                                                                                                 |
| Locize reviewer request                                                       | Points at the repository code owner instead of an upstream account with no access to this organization.                                                                                                                                  |

### Open or owner-recorded

| Item                                                                                      | State                                                   | Owner action                                                                                                                   |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| A contributor can still replace the gate workflow with a same-named job that fakes a pass | Residual, bounded by review                             | Configure an organization ruleset **required workflow** for `ci-gate.yml`; GitHub takes that definition from a trusted source. |
| Sole code owner; platform code-owner review disabled to avoid deadlock                    | Open                                                    | Add a second trusted collaborator to `.github/CODEOWNERS`; do not disable the review requirement.                              |
| Organization secrets not enumerable without org-admin access                              | Unverified                                              | Read names only in Settings → Secrets; never print values.                                                                     |
| Secret scanning and push protection enablement                                            | Owner-recorded enabled on all three public repositories | Keep enabled; enable the organization default so new repositories inherit it.                                                  |
| `main` review/admin/force-push fields                                                     | Owner-recorded                                          | Re-read with an admin token; do not relax them.                                                                                |

## Branches reconciled

| Branch                                         | State                                                                                                                                                                                                                                  |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `governance/ci-gate-and-security` (`2ab4af9c`) | Superseded by PR #314. Trusted-base logic, path-filter parsing, Redis persistence fix and locize reviewer fix were reconciled. Its `merge_group` success path, skipped-as-pass rule, and `CI Gate / Aggregate gate` name were removed. |
| `ci/aggregate-gate` / PR #317 (`6a6ee0bd`)     | Superseded by PR #314. The curated manifest and report-only lanes were not adopted; the required check name did not match branch protection.                                                                                           |
| `fix/shared-baseline-ci` (`c1841ac9`)          | Not consolidated. It carries a separate promotion/dev-branch CI architecture that conflicts with the main-only branch policy. Left intact; do not merge it into the governance change.                                                 |
| `preserve/audit-20261123/*`                    | Explicit preservation branches. Left intact.                                                                                                                                                                                           |

No competing governance pull request is created by this work. #314 is the container.

## Owner steps

1. **Merge order.** Keep branch protection, reviews and administrator enforcement unchanged. Merge
   #314 only after the required check is green at its exact head and an independent approval exists.
   Then let the other pull requests update from `main`.
2. **Verify the bootstrap separately.** Inspect the #314 bootstrap run's summary and the trusted
   script; then confirm `CI gate (installation)` is green on the resulting `main` push.
3. **Close #317** as superseded after #314 merges.
4. **Add a trusted required workflow** at the organization level so a pull request cannot replace the
   gate definition. This is the durable fix for the residual workflow-weakening risk.
5. **Add a second collaborator/code owner** so independent approval and code-owner review are both
   satisfiable without disabling administrator enforcement.
6. **Keep the public-source boundary.** Do not add credentials, private data or public application
   access in exchange for CI minutes. Secret scanning and push protection stay on.

## Verification log

Local gate suite:

```text
node --test .github/scripts/ci-gate.test.mjs
tests 42
pass 42
fail 0
```

The suite exercises the real workflow filters, positive and deliberately failing components,
skipped/cancelled/timed-out lanes, missing workflows, stale runs, wrong pull requests, pagination,
API failures, the bootstrap guard, the control-plane guard and merge-group fail-closed behavior.

Hosted evidence is recorded at the exact head after the push; an earlier run is not evidence for a
later head. See the pull request's `CI gate (aggregate)` check and the `CI gate (installation)` push
run on `main`.
