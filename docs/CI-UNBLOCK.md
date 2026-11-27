# CI unblock: billing, visibility, and runner startup

> Historical diagnostic guidance. The canonical Coderax repository currently reports public visibility; this does not establish owner approval for a public-source policy or verify current runner availability or protection settings. Verify actual exact-head hosted runs and preserve the owner-only application and zero-added-cost boundaries.

## Symptom

Workflow runs fail before `Set up job` with `startup_failure`, `steps=0`, and no
runner assigned. An Actions spending limit or billing problem can prevent runner
startup, but an invalid workflow or incompatible permissions can also fail before
a job starts.

Open the failed run and inspect its annotations. For a confirmed billing or
spending limit error, follow the paid plan or spending limit guidance below.
If the annotations identify a workflow or configuration error, fix that error
and rerun the check. If they do not identify a cause, investigate before
changing billing settings.

## Why a green preview is not evidence

A deployment can be READY while every workflow is startup-blocked. Until a job
actually starts and executes a step, `CI`, `staging`, `production`, and every
multi-agent certification cell remain **UNVERIFIED**.

## Paid plan / spending limit

An organization owner raises or removes the Actions spending limit, or upgrades
the plan. Then trigger `ci-canary.yml` and confirm runner startup before running
the full matrix.

## Self-hosted runner

Register a runner with a dedicated label, then point a small canary job at
`runs-on: [self-hosted, coderax-ci]`. Keep the hosted checks non-required until
the self-hosted runner is proven to survive a reboot and a concurrent job.

## Verification gate

CI is unblocked only when all of the following are true:

- `ci-canary.yml` completes with at least one executed step.
- The required checks run on the exact PR head SHA, not a stale commit.
- `static-checks`, the API/data-schema typechecks, and the affected tests pass.
- The deployment smoke either passes or reports a named, owner-accepted blocker.

This repository's public visibility is intentional. Do not change its visibility as a
CI workaround. Organization owners control billing decisions; this document and the
preflight script prepare diagnostics but do not perform billing or visibility changes.
