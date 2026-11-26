# Main branch protection and releases

`main` is the repository's only persistent branch and the target for every pull request. There is
no `dev`, `canary`, `dev-staging` or promotion branch, and none should be recreated. Feature
branches are short-lived, exist only for the pull request they carry, and are deleted after merge.
[`AGENTS.md`](../AGENTS.md) is the contributor and agent policy; this page records the platform
setup that policy depends on.

## Current protection

The public branch API reports `main` as protected, with one required status check:

| Rule                              | Value                               | Source                                                |
| --------------------------------- | ----------------------------------- | ----------------------------------------------------- |
| Protected                         | yes                                 | `GET /repos/Auctivon-CoderaxAI/Coderax/branches/main` |
| Required check                    | `CI gate (aggregate)`               | branch API (`required_status_checks.checks`)          |
| Required app                      | GitHub Actions, `app_id` 15368      | branch API                                            |
| Enforcement                       | everyone                            | branch API                                            |
| At least one independent approval | yes                                 | owner-recorded                                        |
| Dismiss stale approvals           | yes                                 | owner-recorded                                        |
| Require approval of the last push | yes                                 | owner-recorded                                        |
| Conversation resolution           | yes                                 | owner-recorded                                        |
| Code-owner review                 | no — sole code owner would deadlock | owner-recorded                                        |
| Administrator enforcement         | yes                                 | owner-recorded                                        |
| Force pushes / deletion           | blocked                             | owner-recorded                                        |

The public branch API exposes only the required-check summary. Review counts, stale-approval
dismissal, administrator enforcement, force-push and deletion rules need an admin read; re-read them
with an authenticated owner token before treating the owner-recorded rows as current.

Do not relax any of these rules to land a change. If the required check blocks a merge, fix the
change or the failing component. Do not disable administrator enforcement, drop the review
requirement, add a bypass actor, or remove the required check.

## One aggregate check, not one per component

Every component workflow is path-filtered. Requiring `Static checks`, `Tests: Ubuntu`, `e2e`,
`Lighthouse` or `a11y` by name leaves a pull request permanently pending on an "Expected" check that
its paths never trigger. Requiring nothing lets a change merge without evidence.

`CI gate (aggregate)` (`.github/workflows/ci-gate.yml`) is therefore the only required check:

- It has no `paths` filter and runs on every pull request to `main`.
- It reads each component workflow's own `on.pull_request` filters from the **base** revision and
  evaluates the workflows those filters select for the pull request's diff.
- It evaluates only workflow runs created for this pull request at the **exact head SHA**, choosing
  the latest attempt. An older success cannot mask a newer cancellation.
- `failure`, `cancelled`, `timed_out`, `action_required`, `startup_failure`, `stale`, `neutral`,
  `skipped` and a completed run with no conclusion all fail the gate. A skipped lane verified
  nothing.
- A workflow whose filter matches the diff but that never reports fails after the start grace.
- It excludes its own workflow, so it never waits on itself.
- A failed, partial or paginated-short API read is never evaluated as an empty passing snapshot.
  The gate retries, and fails at the deadline if no complete snapshot was available.
- It evaluates commit statuses alongside workflow runs.
- It fails closed on an empty changed-file list.

A workflow newly added by the pull request is not a required lane. Only the base revision decides
what must gate. A base workflow that starts despite the gate's filter reading is still evaluated, so
a parser disagreement fails toward waiting rather than toward an early green.

The check name must stay exactly `CI gate (aggregate)`. Renaming the job leaves branch protection
waiting on a check that no longer exists.

## Trusted logic and the bootstrap

A `pull_request` run normally executes the pull request's copy of the workflow file. The gate
therefore:

1. checks out the pull request revision (used only for the bootstrap);
2. checks out `.github/scripts`, `.github/workflows` and `.github/CODEOWNERS` from the base SHA;
3. uses the base gate script, base test suite and base workflow filters when they exist;
4. refuses to run if the base has the workflow but not the script;
5. falls back to the pull request copy only when the base has **neither** the gate nor the script,
   and only when the author is an `OWNER`/`MEMBER` or is named as a user code owner in the base
   `.github/CODEOWNERS`. This organization reports its owner as `COLLABORATOR`, so the trusted
   base code-owner file is the actual owner test for the bootstrap.

The fallback is the one-time bootstrap for the pull request that introduces the gate. It is reported
as a workflow warning and in the job summary, and it disappears as soon as the gate is on `main`.
It is not a permanent trusted implementation. A contributor cannot use it.

Branch protection already requires `CI gate (aggregate)` while the workflow exists only on the
bootstrap pull request. The safe bootstrap is therefore:

1. Keep protection, reviews and administrator enforcement exactly as they are.
2. Merge the pull request that carries the gate (currently PR #314) only after its own gate passes at
   its exact head and an independent reviewer has inspected the bootstrap copy.
3. After merge, confirm the `CI gate (installation)` push run on `main` is green. That job self-tests
   the installed gate and asserts it still has no path filter and still declares `merge_group`.
4. Other pull requests update from `main` and then receive the check. Until they do, they are blocked
   by the existing rule. That is fail-closed behavior, not a reason to remove the rule.

The residual risk is the bootstrap run itself: its workflow file is pull-request-owned. Review that
run separately; do not treat a green bootstrap as evidence that the permanent trust model has already
been exercised.

## Preventing a contributor from weakening their own gate

The gate logic, tests and workflow filters come from the base revision. In addition, any change under
`.github/workflows/`, `.github/scripts/ci-gate.mjs`, `.github/scripts/ci-gate.test.mjs` or
`.github/CODEOWNERS` requires an approval at the exact head from a user code owner unless the author
is already an `OWNER`/`MEMBER` or is a user code owner in the base `.github/CODEOWNERS`. Stale
approvals on earlier heads do not count.

That guard cannot run if a contributor replaces the workflow with a job that never invokes the gate.
The required check then goes missing and blocks the merge, unless the replacement keeps the name and
fakes a pass. The durable fix is an organization ruleset required workflow, which GitHub evaluates
from a trusted definition that a pull request cannot edit. Until the owner configures one, review
every `.github/workflows/**` change as security-sensitive and keep code-owner review in the review
process even though the platform rule is disabled for the sole owner.

## Merge queue

The gate declares `merge_group` so an enabled merge queue gets an explicit failing check instead of
a silently pending one. It **fails closed** unless every component pull-request workflow also declares
`merge_group`. None does today, so a merge queue is not supported.

Do not report success on `merge_group` merely because component workflows are absent. To enable a
merge queue:

1. add `merge_group` to every component workflow the gate can require;
2. verify each component can run with merge-group context (no `github.event.pull_request` fields);
3. keep the gate's genuine merge-candidate evaluation, which compares the merge-group base and head
   and reads `merge_group` runs at the exact candidate SHA;
4. test a queued pull request before enabling the queue for `main`.

Until then, enabling the queue makes every candidate fail visibly. That is the intended fail-closed
state.

## Independent approval at zero cost

`enforce_admins: true` together with one required approval and a single repository owner freezes
`main`: the owner cannot approve their own pull request. The fix is not to weaken the rule.

The zero-cost mechanism is a second collaborator. Public repositories include free collaborators, so
a second trusted maintainer can hold `write` access, review, and approve without a plan change or
spend. Add them to `.github/CODEOWNERS` before relying on code-owner review.

A bot whose review event is a comment rather than an approval does not satisfy the required review.
Never self-approve, and never record a bot review as a human approval.

## Releases

Releases are cut from a reviewed `main` commit by pushing a `v<semver>` or `v<semver>-rcN` tag.
`tag-images.yml` validates the tag and publishes the release images, and
`main-image-workflow.yml` builds the latest release image on dispatch. Keep `main` as the release
source: never move a tag, move `main` backwards, or force-push it. Roll back code with a new
reviewed revert pull request.
