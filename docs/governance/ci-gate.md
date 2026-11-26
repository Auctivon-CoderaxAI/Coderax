# Aggregate CI gate

`CI gate (aggregate)` is the single required status check on `main`. It is backed by
[`.github/workflows/ci-gate.yml`](../../.github/workflows/ci-gate.yml) and
[`.github/scripts/ci-gate.mjs`](../../.github/scripts/ci-gate.mjs). This page is the design and
operations reference; [`MAIN_BRANCH.md`](../../.github/MAIN_BRANCH.md) records the branch rule.

## Why one aggregate check

Every component workflow in this repository is path-filtered. A pull request that changes only
`client/src/**` never starts the backend workflows; one that changes only documentation starts almost
nothing. A required check that names a component stays **Expected** forever on a pull request its
filter does not match, and GitHub treats a never-reported required check as unmet.

Requiring the component workflows individually therefore disables the merge button for reasons
unrelated to the change. Requiring nothing lets a change merge with no evidence. The aggregate check
is the middle path: it always reports, and it evaluates only the component workflows that apply to
this diff.

## Decision rules

The gate reads every component workflow's `on.pull_request` block from the base revision:

- `paths` and `!`-prefixed exclusions select the diff;
- `paths-ignore` excludes only when every changed file is ignored;
- `branches` and `branches-ignore` select the target branch;
- `types` selects the pull-request activity; the default is opened, synchronize and reopened.

For each applicable workflow, the gate evaluates the workflow run GitHub created for this pull
request at the exact head SHA:

| Observed state                                                                     | Gate result                                             |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `success`                                                                          | pass                                                    |
| `failure`, `cancelled`, `timed_out`, `action_required`, `startup_failure`, `stale` | fail                                                    |
| `neutral`, `skipped`                                                               | fail — the lane did not affirmatively verify the change |
| completed with no conclusion                                                       | fail                                                    |
| not completed after the start grace                                                | fail as missing                                         |
| not completed before the deadline                                                  | fail as timed out                                       |
| no run, and its own filter does not select this diff                               | not applicable                                          |
| no run, and its own filter selects this diff                                       | fail after the start grace                              |

A workflow newly added by the pull request is never a required lane. A base-revision workflow that
starts even though the gate's parser did not select it is still evaluated, so a parser disagreement
fails toward waiting rather than toward an early green.

Commit statuses at the same SHA are evaluated too: `failure` and `error` fail, `pending` waits, and
`success` passes.

## Exact-head provenance

Only runs with all of the following are considered:

- `head_sha` equal to `github.event.pull_request.head.sha`;
- `event` equal to `pull_request`;
- `repository.full_name` equal to the base repository;
- a `pull_requests` entry matching this pull request when GitHub supplies one;
- a workflow path in the base revision.

The latest `run_attempt` for each workflow path wins. An older successful attempt cannot mask a newer
cancellation or failure. A run at another SHA, from another event, from another pull request, or from
a third-party app cannot satisfy the gate.

The gate excludes its own workflow path. It never waits on the `CI gate (aggregate)` check itself.

## Pagination and API failures

Every list endpoint follows the `Link: rel="next"` chain, with a page cap. A cap hit is an error, not
a partial view. A changed-file list that is empty or at GitHub's 3,000-file cap is an error. A
pagination response with the wrong shape or the wrong SHA is an error.

A failed or partial observation is discarded. The gate retries until the deadline and then fails
with "timed out without a complete snapshot". It never evaluates an API failure as an empty snapshot
and never reports a pass from unavailable data. A successful empty response is different: it means
no component workflow applied, and it passes after the registration window.

## Trusted logic

A `pull_request` workflow normally executes the pull request's own workflow file. That is
unacceptable for a required check, so the gate:

1. checks out the pull request revision, used only for the one-time bootstrap;
2. checks out `.github/scripts`, `.github/workflows` and `.github/CODEOWNERS` from the base SHA;
3. prefers the base script, base test suite and base workflow filters;
4. refuses to run if the base has the workflow but not the script;
5. falls back to the pull request copy only when the base has neither, and only for an
   `OWNER`/`MEMBER` author or a user code owner named in the base `.github/CODEOWNERS`. The base
   file is trusted; the pull request cannot add its author to it.

The fallback is marked as a bootstrap in the workflow warning and the job summary. It is not a
permanent trusted implementation. Once the gate is on `main`, every later pull request uses the base
copy and the fallback is unreachable for contributors.

### Protecting the control plane

An external contributor who changes any of the following needs an approval at the exact head from a
user code owner, unless the author is already an owner, member or a user code owner in the base
`.github/CODEOWNERS`:

- `.github/workflows/` (all workflows);
- `.github/scripts/ci-gate.mjs`;
- `.github/scripts/ci-gate.test.mjs`;
- `.github/CODEOWNERS`.

The approval must be on the current head; an approval on an earlier push does not count. The guard
runs from the trusted script, so a contributor cannot edit it away without also changing the
workflow. If the workflow itself is replaced with a job that never invokes the gate, the required
check goes missing and the merge is blocked; the remaining risk is a replacement that keeps the check
name and fakes a pass.

The durable fix for that residual risk is an organization ruleset **required workflow**, which GitHub
takes from a trusted definition rather than the pull request. It is an owner step; see the tracker.
Until it is configured, treat every `.github/workflows/**` change as security-sensitive and keep
code-owner review in the review process.

## Bootstrap

Branch protection already requires `CI gate (aggregate)`, while the workflow exists only in the
pull request that introduces it. That is intentional: the rule is not relaxed for the bootstrap.

1. Keep protection, reviews and administrator enforcement unchanged.
2. Let the bootstrap pull request run its own copy once. The gate marks the run as bootstrap, and the
   self-test step still runs.
3. Review the bootstrap copy and the job summary manually. A green bootstrap is not evidence that the
   permanent trusted path has run.
4. Merge only when the required check is green at the exact head and an independent approval exists.
5. After merge, the `CI gate (installation)` job runs on the push to `main`, self-tests the installed
   gate, and asserts it has no path filter and declares `merge_group`.
6. Other pull requests update from `main` before their required check can appear. Their temporary
   block is fail-closed, not a reason to remove the rule.

## Merge queue

The gate declares `merge_group` so a queue gets an explicit failing check instead of a pending one.
It reports **failure** unless every component pull-request workflow also declares `merge_group`:
component runs do not exist on a merge-group candidate otherwise, and reporting success because the
runs are absent is exactly the failure mode this gate exists to prevent.

Genuine support requires:

- `merge_group` on every gating component workflow;
- component jobs that do not depend on `github.event.pull_request` context;
- the gate's merge-candidate path, which compares the merge-group base and head, evaluates
  `merge_group` runs at the candidate SHA, and applies the same provenance and failure rules;
- a tested queue entry before enabling the queue for `main`.

Until those hold, enabling the queue makes every candidate fail visibly. That is the intended
fail-closed state.

## Operating parameters

The defaults are set in `.github/scripts/ci-gate.mjs` and can be overridden by environment variables:

| Variable                    | Default | Purpose                                                        |
| --------------------------- | ------- | -------------------------------------------------------------- |
| `GATE_TIMEOUT_SECONDS`      | 5400    | overall decision deadline (the job is capped at 95 minutes)    |
| `GATE_POLL_SECONDS`         | 30      | observation interval                                           |
| `GATE_START_GRACE_SECONDS`  | 300     | how long an applicable workflow may be missing before it fails |
| `GATE_SETTLE_SECONDS`       | 60      | quiet period after every observed run completes                |
| `GATE_EMPTY_SETTLE_SECONDS` | 60      | registration window when no workflow matches                   |
| `GATE_API_RETRIES`          | 4       | per-request transient retry count                              |
| `GATE_RETRY_BASE_MS`        | 2000    | exponential retry base                                         |
| `GATE_MAX_RUN_PAGES`        | 10      | run pagination cap                                             |
| `GATE_MAX_STATUS_PAGES`     | 10      | status pagination cap                                          |
| `GATE_MAX_FILE_PAGES`       | 30      | changed-file pagination cap                                    |

The workflow uses the default `GITHUB_TOKEN` with read-only permissions (`contents`, `actions`,
`statuses`, `pull-requests`). It needs no repository secret, so a fork pull request behaves like a
same-repository one.

## What not to do

- Do not add a component workflow as a second required check. It is path-filtered and will go
  permanently pending.
- Do not rename the `CI gate (aggregate)` job; branch protection names it exactly.
- Do not report success on `merge_group` because component runs are absent.
- Do not add report-only exemptions for a failing test lane. Fix the lane or leave it blocking; a
  red required gate is evidence, not an inconvenience.
- Do not disable administrator enforcement, the review requirement or the required check to land a
  change.
- Do not add a secret to the gate workflow. It needs none.

## Verification

Local:

```bash
node --test .github/scripts/ci-gate.test.mjs
```

The suite covers the real workflow filters, the self workflow's unfiltered contract, positive and
deliberately failing component runs, skipped and cancelled runs, missing workflows, stale runs, wrong
PRs, pagination, API failures, the bootstrap guard, the control-plane guard and merge-group
fail-closed behavior.

Hosted:

```bash
gh pr checks <PR> --repo Auctivon-CoderaxAI/Coderax
gh api repos/Auctivon-CoderaxAI/Coderax/commits/<HEAD_SHA>/check-runs \
  --jq '.check_runs[] | select(.name == "CI gate (aggregate)") | {status, conclusion, head_sha}'
```

A green badge on an earlier head is not evidence for the current head. Record the exact SHA with the
result.
