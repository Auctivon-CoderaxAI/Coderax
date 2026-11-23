# CI unblock: billing, visibility, and runner startup

## Symptom

Workflow runs fail before `Set up job` with `startup_failure`, `steps=0`, and no
runner assigned. An Actions spending limit or billing problem can prevent runner
startup, but an invalid workflow or incompatible permissions can also fail before
a job starts.

Open the failed run and inspect its annotations. Follow Option A or B only when
the annotations confirm a billing or spending limit error. If they identify a
workflow or configuration error, fix that error and rerun the check. If the
annotations do not identify a cause, investigate before changing billing or
repository visibility.

## Why a green preview is not evidence

A deployment can be READY while every workflow is startup-blocked. Until a job
actually starts and executes a step, `CI`, `staging`, `production`, and every
multi-agent certification cell remain **UNVERIFIED**.

## Option A — public repository (free standard runners)

GitHub-hosted standard runners are free for public repositories. This is the
fastest unblock for a repository that contains no secrets and no code that must
stay private.

1. Run the preflight in `scripts/ci/public-preflight.sh` and review its output.
2. Confirm no real credential exists in the current tree or history.
3. An organization owner performs the change:

   ```bash
   gh repo edit AUCTIVON-OWNER/REPO \
     --visibility public \
     --accept-visibility-change-consequences
   ```

4. Trigger the canary:

   ```bash
   gh workflow run ci-canary.yml --repo AUCTIVON-OWNER/REPO
   gh run list --repo AUCTIVON-OWNER/REPO --workflow ci-canary.yml --limit 1
   ```

5. Confirm the run has `steps > 0` and a real runner name. Only then rerun the
   required checks on the exact candidate SHA.

**Do not** make a repository public to bypass a failure that a test would catch.
Visibility changes expose history and forks; they are not a substitute for a fix.
If a secret is found, rotate it first, then decide whether the repository can be
public at all.

## Option B — paid plan / spending limit

An organization owner raises or removes the Actions spending limit, or upgrades
the plan. Then trigger `ci-canary.yml` and confirm runner startup before running
the full matrix.

## Option C — self-hosted runner

Register a runner with a dedicated label, then point a small canary job at
`runs-on: [self-hosted, coderax-ci]`. Keep the hosted checks non-required until
the self-hosted runner is proven to survive a reboot and a concurrent job.

## Verification gate

CI is unblocked only when all of the following are true:

- `ci-canary.yml` completes with at least one executed step.
- The required checks run on the exact PR head SHA, not a stale commit.
- `static-checks`, the API/data-schema typechecks, and the affected tests pass.
- The deployment smoke either passes or reports a named, owner-accepted blocker.

The current repository is private. The billing/visibility decision belongs to
the organization owner; this document and the preflight script prepare it, but
do not perform it in a code change.
