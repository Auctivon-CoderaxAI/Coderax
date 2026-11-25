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
- Required status checks for the backend, frontend, static-check, integration, security and e2e
  workflows, evaluated at the exact head SHA. A passing run at an earlier head is not a pass.
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

## Releases

Releases are cut from a reviewed `main` commit by pushing a `v<semver>` or `v<semver>-rcN` tag.
`tag-images.yml` validates the tag and publishes the release images, and
`main-image-workflow.yml` builds the latest release image on dispatch. Keep `main` as the release
source: never move a tag, move `main` backwards, or force-push it. Roll back code with a new
reviewed revert pull request.
