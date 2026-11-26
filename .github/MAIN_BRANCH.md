# Main branch protection and releases

`main` is the repository's only persistent branch and the target for every pull request. There is
no `dev`, `canary`, `dev-staging` or promotion branch, and none should be recreated. Feature
branches are short-lived, exist only for the pull request they carry, and are deleted after merge.
[`AGENTS.md`](../AGENTS.md) is the contributor and agent policy; this page records the platform
setup that policy depends on.

## Required protection (administrator)

Configure rulesets/branch protection for `main` with:

- Every change through a pull request; direct pushes denied, including for administrators.
- At least one independent approval, with approval of the most recent reviewable push by someone
  other than its author and stale approvals dismissed when the pull request changes.
- Exactly one required status check, `CI Gate / Aggregate gate`, evaluated at the exact head SHA. A
  passing run at an earlier head is not a pass.
- Code-owner review for `.github/workflows/`, `.github/scripts/` and `.github/CODEOWNERS`.
- All review threads resolved before merge.
- Force pushes and branch deletion disallowed.
- No administrator override, self-approval or force-merge.

`.github/CODEOWNERS` requests review from `@nnabdelshahid` for the whole repository. GitHub
enforces that only where the branch rule requires code-owner review; with a sole code owner their
own pull requests cannot satisfy the requirement, so an additional eligible owner is needed if
those changes are to merge through the normal path.

Where the hosting plan cannot enforce a rule, record the equivalent review step in the pull request
instead of claiming platform enforcement. Do not relax the remaining rules to compensate.

## One required check, not one per component

Every component workflow here is path-filtered, so on any given pull request most of them create no
check run at all. Naming one of them as a required check leaves that check **pending forever** on the
pull requests its filter does not cover. GitHub reads a never-reported required check as unmet, so
the merge button stays disabled for a reason unrelated to the change.

`.github/workflows/ci-gate.yml` is therefore the only required check:

- It has no `paths` filter, so it always reports on every pull request. A test asserts this, so the
  gate cannot silently acquire a filter.
- It reads each component workflow's own `on.pull_request.paths` and `on.pull_request.branches`, so a
  filter is declared once, in the workflow that owns it.
- It waits for every workflow the diff actually triggers to reach a conclusion at the pull request's
  exact head SHA, and fails when one failed, was cancelled, timed out, or never reported.
- It also waits on any workflow that started even if its own filter says it should not have, which
  makes a parser disagreement fail toward waiting rather than toward an early green.
- It never waits on itself: its own workflow path is excluded from the expected set, and a test
  proves that an in-progress `CI Gate` run cannot hold its own check open.
- It fails closed on an empty changed-file list. Filtering every workflow out of an empty diff would
  report green, which is the failure the gate exists to prevent.
- It executes gate logic and workflow filters from the **base revision**, not from the pull request
  merge tree. A `pull_request` run otherwise executes the contributor's copy of `ci-gate.mjs`, and a
  required check must not be editable by the change it judges. Only the started-run set is taken from
  the pull request. When the base revision has no gate yet, it runs the pull request's copy and emits
  a warning; that applies to the pull request that introduces the gate and to no later one.
- It answers `merge_group` directly. Component workflows do not declare that trigger, so they start
  no runs in a merge queue; the gate reports success there and records that the queued pull request
  was already gated at its own head. Without it, enabling a merge queue would leave the single
  required check pending forever.
- `Codegraph Select (observe)` is listed as advisory **by workflow path** in
  `.github/scripts/ci-gate.mjs`: it records which tests a change selects and is not a merge gate.
  Matching by path rather than display name means renaming a workflow cannot quietly un-gate it.
  Every workflow added to that list needs the same justification.

Component workflows stay path-filtered and stay individually visible; they are simply not required
individually. Do not add a second required check without removing the path filter from the workflow
it names.

## Check names that actually exist

A check run is named `<workflow name> / <job name>`. A required check must be set to that exact
string, so it has to be chosen from a run that already exists rather than typed from memory. The
verified register of every pull-request-triggered check in this repository is in
[`docs/governance/cross-repo-tracker.md`](../docs/governance/cross-repo-tracker.md#verified-check-name-register).

Two traps the register makes visible:

- Job names containing `${{ matrix.* }}` are expanded at run time (`Tests: api (shard 1/3)`). The
  literal template string is never a check name, so requiring it would leave the check pending.
- `Codegraph select` exists as a job name in three different workflows. Selecting a bare job name is
  ambiguous; always use the full `<workflow> / <job>` form.

## Independent approval at zero cost

`enforce_admins: true` together with one required approval and a single repository owner freezes
`main`: the owner cannot approve their own pull request, and no other account can, so nothing
merges. That is a real conflict, and the fix is not to weaken the rule.

The zero-cost, plan-compatible mechanism is a **second collaborator**. Public repositories include
unlimited free collaborators, so a second trusted maintainer can hold write access, review, and
approve without any plan change or spend. This is what makes independent approval meaningful rather
than nominal.

- Add the second maintainer with `write` (not `admin`) access.
- Keep administrator enforcement on, and keep stale-approval dismissal on.
- Keep code-owner review on. `@nnabdelshahid` is the sole code owner, so their own pull requests
  cannot satisfy that rule; the second maintainer can, provided they are also a code owner. Add them
to `.github/CODEOWNERS` before enabling the rule, or their approval satisfies the approval count but
not the code-owner requirement.

Do not substitute a bot or app review for the approval. Automated reviewers comment; GitHub counts
only reviews from accounts with write access as approvals, and recording one as a human approval
would be fabrication.

Until a second approver exists, a pull request that meets every other gate stays unmerged and says
so. It does not drop the approval requirement.

## Releases

Releases are cut from a reviewed `main` commit by pushing a `v<semver>` or `v<semver>-rcN` tag.
`tag-images.yml` validates the tag and publishes the release images, and
`main-image-workflow.yml` builds the latest release image on dispatch. Keep `main` as the release
source: never move a tag, move `main` backwards, or force-push it. Roll back code with a new
reviewed revert pull request.
