# Private-repository readiness — Coderax

Status: prepared for GitHub Free private operation at $0 additional spend. Visibility is unchanged.

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

- **Secret scanning / push protection** are public-only on Free. `secret-scan.yml` runs gitleaks over history. Push blocking has no free private equivalent; detection runs after the push.
- **npm publishing**: provenance requires a public source repository and was removed from the three manual publish workflows. They still use npm OIDC and reference the `publish` environment, but [GitHub Free ignores environment protection rules and environment secrets after privatization](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments). Arrange release approval before changing visibility.
- **GHCR storage**: [Container registry image storage and bandwidth are currently free](https://docs.github.com/en/billing/concepts/product-billing/github-packages); the 500 MB GitHub Free package storage allowance does not apply to GHCR images. Build cache moved to the Actions cache. Keep automatic main-branch publishing opt-in to control when images are built and pushed to GHCR and Docker Hub. Tag releases still publish.
- **Cross-repository fixture**: set `NATIVE_CODE_REPO_TOKEN` (read-only) and optionally `NATIVE_CODE_REPOSITORY` before privatizing.
- **Rulesets / protected branches** are unavailable for private repos on Free. The `test` aggregation job remains advisory; enforcement needs Team or a manual merge policy.

## Cost posture

- GitHub-hosted standard runners only; no self-hosted runner is referenced.
- `concurrency` with `cancel-in-progress` covers repeated pushes.
- macOS acceptance is path-filtered to `e2e/byom/**`; Windows packaging to `desktop/**`.
- Artifact retention is 1–7 days; Docker digests are retained one day.

## Owner action before privatizing

1. Add `NATIVE_CODE_REPO_TOKEN` with read-only access to the fixture repository. Before privatizing, confirm that the macOS acceptance job passes for the exact revision on a trusted run. Record that result in the PR and require it manually where the hosting plan cannot enforce it. A successful `Native workspace acceptance not verified` job means the macOS tests did not run.
2. Arrange a manual npm release approval process: have an independent reviewer record approval for the exact release commit in the release PR. An authorized maintainer dispatches the publish workflow on `main` only while that commit is its tip and confirms the run used the approved SHA. Verify the npm trusted publisher configuration and identify any dependency on environment secrets before cutover. If manual approval is insufficient, keep the repository public until an enforceable release gate is in place.
3. Enable `ALLOW_IMAGE_PUBLISH=true` only if automatic main-branch builds and pushes to both registries are wanted.
4. In [GitHub billing settings](https://docs.github.com/en/billing/how-tos/set-up-budgets), set a separate $0 budget for each relevant metered product (for example, Actions and Packages), scoped to the account or organization that pays for this repository. Enable **Stop usage when budget limit is reached** for each budget that offers it. If a product cannot be capped, keep its paid usage disabled. Alerts alone do not stop charges.
