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
- One required status check, **`CI gate`** (`.github/workflows/ci-gate.yml`), evaluated at the exact
  head SHA. A passing run at an earlier head is not a pass; the gate reruns on every push and reads
  the head it is attached to.
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

## The aggregate gate

Almost every workflow in this repository is path-filtered, so a pull request that touches one area
starts only the lanes that cover it. A required check whose workflow never starts can never turn
green, and the usual workaround — requiring nothing — lets a change merge with no evidence.

`CI gate` is the one check to require. It always runs, and it evaluates the lanes named in
[`required-checks.json`](required-checks.json) using GitHub's own record of what this diff
triggered:

- a required check that reported `success` or `neutral` passes;
- a required check that reported a failure, a cancellation, or `skipped` fails — a skipped job
  verified nothing, whatever its reason;
- a required check that never appeared passes only when its workflow produced no run at this head,
  the lane is declared path-filtered, and a settle window has elapsed so the workflow could have
  started. If the workflow did run, the missing check is a failure.

Because presence comes from GitHub's own evaluation of each workflow's `paths:` filter, there is no
second copy of those filters to drift. `ci-gate.test.mjs` reads every workflow the manifest names
and fails the gate if a lane claims a path filter the workflow does not declare, or if a required
workflow stops triggering on `pull_request`.

`reportOnly` lanes are printed in the job summary and do not block. Each carries the reason it is
not enforced yet; move a lane into `required` once that reason no longer holds. Adding a lane to
`required` without fixing its outstanding failure makes every pull request red, which is why the
list is explicit instead of inferred.

`CI gate` is the only check that belongs in branch protection; the other workflows remain the
evidence it reads.

## Releases

Releases are cut from a reviewed `main` commit by pushing a `v<semver>` or `v<semver>-rcN` tag.
`tag-images.yml` validates the tag and publishes the release images, and
`main-image-workflow.yml` builds the latest release image on dispatch. Keep `main` as the release
source: never move a tag, move `main` backwards, or force-push it. Roll back code with a new
reviewed revert pull request.
