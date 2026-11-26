# Private-repository readiness — Coderax

Status: **not yet ready** for GitHub Free private operation at $0 additional spend. Visibility is unchanged. The workflow cleanup is prepared, but the measured Actions-minute budget below is a blocking constraint.

## Removed workflows

Nine workflows were starter templates or leftovers that cannot apply here:

| Workflow | Why removed |
|---|---|
| `jekyll-docker.yml` | No Jekyll site or `_config.yml`; generic GitHub starter. |
| `python-package-conda.yml` | No conda environment or Python package to build. |
| `webpack.yml` | No webpack config; the client uses its own toolchain, and the matrix targets Node 18/20/22 while the repo uses Node 24. |
| `deno.yml` | No `deno.json`/`deno.jsonc`. |
| `go-ossf-slsa3-publish.yml` | No `.slsa-goreleaser.yml`; the only Go module is `otel/langfuse-fanout`, covered by `langfuse-fanout.yml`. |
| `docker-image.yml` | Generic `docker build … my-image-name` stub duplicate of `docker-publish.yml`. |
| `dev-staging-images.yml` | Publishes `lc-dev-staging-*`, stale LibreChat names, duplicating `dev-images.yml`. |
| `helmcharts.yml` | `cd helm/coderax-rag-api` does not exist; only `helm/librechat*` remain. |
| `copilot-code-review.yml` | Contains no review step; it only checks out its own file. |

`ci-canary.yml` is kept because `docs/CI-UNBLOCK.md` uses it to prove runner allocation.

## Public-only features replaced

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:d2fccff80d9063ef2a1011e21abc47fb630876370360b29dc7bd66e9f978f34c -->

- **Secret scanning / push protection** are public-only on Free. `secret-scan.yml` scans commits introduced by each PR or main push, and audits full history on a schedule or manual dispatch. Superseded PR scans can be canceled; each push and audit has an independent run. Push blocking has no free private equivalent; detection runs after the push.
- **npm publishing**: provenance requires a public source repository and was removed from the three manual publish workflows. They still use npm OIDC and reference the `publish` environment, but [GitHub Free ignores environment protection rules and environment secrets after privatization](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments). Arrange release approval before changing visibility.
- **GHCR storage**: [Container registry image storage and bandwidth are currently free](https://docs.github.com/en/billing/concepts/product-billing/github-packages); the 500 MB GitHub Free package storage allowance does not apply to GHCR images. Build cache moved to the Actions cache. Keep automatic main-branch publishing opt-in to control when images are built and pushed to GHCR and Docker Hub. Tag releases still publish.
- **Cross-repository fixture**: hosted macOS acceptance runs only on manual dispatch from `main`. Keep the fixture token out of repository and organization secrets. On a plan that enforces environment restrictions, use the `native-workspace-acceptance` environment with access limited to the `main` branch, require review where supported, and store `NATIVE_CODE_REPO_TOKEN` there with read-only access to the fixture repository. Set `NATIVE_CODE_REPOSITORY` if the fixture repository has moved.
- **Rulesets / protected branches** are unavailable for private repos on Free. The `test` aggregation job remains advisory; enforcement needs Team or a manual merge policy.

## CI minute budget (blocking)

GitHub-hosted standard runners are free for public repositories. A private repository on GitHub Free shares 2,000 included Actions minutes per month across the organization; macOS minutes count 10× and Windows minutes 2×.

Measured on 2026-11-26 from the repository's own run records: the 1,000 most recent workflow runs in the preceding 30 days contain at least **6,659 minutes of wall-clock run time**. That is a lower bound — the sample stops at 1,000 runs — and it excludes the macOS and Windows multipliers, so the billable total is higher than the 2,000 included minutes. Superseded and failed runs are included because GitHub bills the runner time they consume.

Privatizing now would exceed the included allowance and can block Actions or incur charges, violating the $0 requirement. Do not change visibility until one of these is true:

- billable usage for a full month measures below 2,000 minutes after the workflow cleanup; or
- an authorized cloud-hosted self-hosted runner (for example Oracle Always Free, which already hosts this deployment) carries the heavy lanes, and GitHub-hosted usage stays within the allowance.

A self-hosted runner on the owner's personal computer is excluded by the cloud-only policy. Re-measure from the billing usage API before changing visibility; the run-duration estimate above is not a billing statement.

## Cost posture

- GitHub-hosted standard runners only; no self-hosted runner is referenced.
- Superseded runs are canceled where the replacement provides equivalent coverage. Each main push and full-history secret audit scans independently.
- Native acceptance reports its unverified status on PRs that change `e2e/byom/**` or the workflow itself. Hosted macOS tests require an explicit dispatch. Windows packaging is path-filtered to `desktop/**`.
- Artifact retention is 1–7 days; Docker digests are retained one day.

## Owner action before privatizing

0. Approve a CI-minute plan before changing visibility. Measure billable Actions usage for a full month; if it exceeds 2,000 minutes, remove or narrow lanes or attach an authorized cloud self-hosted runner first. The public repository is free today.
1. For PRs affecting native acceptance, review the exact proposed revision before running both [native acceptance variants](../e2e/byom/README.md) on a trusted Mac with the pinned fixture revision. Record the tested SHA and result in the PR before merging. On GitHub Free private repositories, use this local procedure because the protected environment and its secret are unavailable. Remove any repository or organization copy of the fixture token before enabling this workflow. A successful `Native workspace acceptance not verified` job reports that the hosted macOS tests did not run; it does not satisfy the acceptance requirement.
2. Keep the repository public until all three npm publish workflows (`client.yml`, `data-provider.yml`, and `data-schemas.yml`) require an approved commit SHA as a manual dispatch input and `publish-npm` stops before `npm publish` if `github.sha` does not match it. The current manual procedure cannot prevent publishing a different commit: an independent reviewer records approval for the exact release commit, and an authorized maintainer checks that it is the tip of `main` before dispatch, but `main` can advance between that check and dispatch. Checking the run SHA afterward only detects a mismatch after the workflow could already have published. Verify the npm trusted publisher configuration and identify any dependency on environment secrets before cutover. If a run is canceled, check the registry version and run SHA before retrying: a canceled run can already have published.
3. Enable `ALLOW_IMAGE_PUBLISH=true` only if automatic main-branch builds and pushes to both registries are wanted.
4. In [GitHub billing settings](https://docs.github.com/en/billing/how-tos/set-up-budgets), set a separate $0 budget for each relevant metered product (for example, Actions and Packages), scoped to the account or organization that pays for this repository. Enable **Stop usage when budget limit is reached** for each budget that offers it. If a product cannot be capped, keep its paid usage disabled. Alerts alone do not stop charges.

<!-- /coderabbit-ai-generated:v1 -->
