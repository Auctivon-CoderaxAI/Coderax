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
- Required status checks at the exact head SHA, through one always-running aggregate check,
  `CI gate (aggregate)` (`.github/workflows/ci-gate.yml`). A passing run at an earlier head is not a
  pass. The gate evaluates every GitHub Actions check run that exists at the head, so a path-filtered
  component that did not apply is a pass and one that ran and failed is a failure. Do not add the
  component workflows as separate required checks: they are path-filtered, and a required check that
  never runs leaves the pull request permanently pending on an expected status.
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

On the free plan, public repositories still enforce every rule above. The binding constraint is
review capacity, not the plan: the organization has two members, and an approval from the second
member is the zero-cost independent review. A bot whose review event is a comment rather than an
approval does not satisfy the required review and must not be treated as one; never self-approve,
and do not disable administrator enforcement because no second reviewer is available.

## Releases

Releases are cut from a reviewed `main` commit by pushing a `v<semver>` or `v<semver>-rcN` tag.
`tag-images.yml` validates the tag and publishes the release images, and
`main-image-workflow.yml` builds the latest release image on dispatch. Keep `main` as the release
source: never move a tag, move `main` backwards, or force-push it. Roll back code with a new
reviewed revert pull request.
