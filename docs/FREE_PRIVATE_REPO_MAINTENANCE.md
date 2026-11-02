# Free private-repository maintenance (Coderax)

This is a practical operating checklist for keeping `CoderaxAI/Coderax` private without upgrading GitHub. It is **not** an alternative form of enforceable branch protection.

## Preserve history before changing it

A remote snapshot branch `backup/pre-free-cleanup-20261029` points at the `main` commit before the October 29, 2026 cleanup. It is **not** a complete off-platform backup and does not copy every other branch, tag, issue, release, or secret.

For an independent repository-history backup, run these commands on a trusted machine with authorized GitHub access:

```sh
git clone --mirror git@github.com:CoderaxAI/Coderax.git Coderax.mirror.git
git -C Coderax.mirror.git bundle create ../Coderax-full.bundle --all
git -C Coderax.mirror.git bundle verify ../Coderax-full.bundle
```

Copy the bundle to private owner-controlled storage. A Git bundle contains Git objects and refs, **not** issues, pull-request review conversations, Actions secrets, wiki contents, or externally hosted assets; export those separately if needed. Do not commit a bundle or credentials to this repository.

**Never** use `git push --force`, `--mirror` against the production remote, orphan-main replacement, or history rewriting as a cosmetic cleanup. Preserve commit provenance and open PR continuity; delete only verified obsolete branches after review.

## GitHub Free and private-repository controls

- This repository is private on GitHub Free. Branch-protection/ruleset enforcement cannot be assumed; confirm the actual account entitlement and API result before claiming it.
- Keep `.github/CODEOWNERS` as a useful reviewer map, but do not claim automatic required-owner reviews are enforceable.
- Use small feature branches, draft PRs where useful, manual diff reviews, local checks, and real CI when the runner is operational.
- Before any merge, inspect current PR reviews, conflicts, relevant tests, branch HEAD, dependency/security findings, and deployment rollback. Do not interpret an empty or runnerless Actions job as a passed test.
- If the documented `dev`/canary/main promotion policy refers to branches that are absent, **stop the promotion** and reconcile it with repository maintainers. This guide does not silently change `AGENTS.md` or authorize direct main merges.
- Preserve release URLs and separate the working deployment from repository-history cleanup.
- Branches named `backup/*` are retention checkpoints, not CI or production branches. Do not delete them as part of a routine feature-branch cleanup.

## Free release gate (process, not platform enforcement)

1. Confirm exact source commit and reviewed diff.
2. Validate locally and/or on a genuinely executing authorized runner; record commands and outcomes.
3. Complete the appropriate reviewer/security checks for the changed subsystems.
4. Merge through the documented and currently viable branch process only when explicitly authorized.
5. Smoke-test the deployed service and retain a known-good rollback target.

No plan upgrade, public-repository conversion, paid runner, or destructive repository operation is required by this document.
