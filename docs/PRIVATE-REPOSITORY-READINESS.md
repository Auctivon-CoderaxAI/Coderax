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

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:f2bc21ab9fe463306a9284d76e3648821bb7af7a430e2118a3e95c3ab97a804b -->

- **Secret scanning / push protection** are public-only on Free. `secret-scan.yml` scans commits introduced by each PR or main push, and audits full history on a schedule or manual dispatch. Superseded PR scans can be canceled; each push and audit has an independent run. Push blocking has no free private equivalent; detection runs after the push.
- **npm publishing**: provenance requires a public source repository and was removed from the three manual publish workflows. They still use npm OIDC and reference the `publish` environment, but [GitHub Free ignores environment protection rules and environment secrets after privatization](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments). Arrange release approval before changing visibility.
- **GHCR storage**: [Container registry image storage and bandwidth are currently free](https://docs.github.com/en/billing/concepts/product-billing/github-packages); the 500 MB GitHub Free package storage allowance does not apply to GHCR images. Build cache moved to the Actions cache. Keep automatic main-branch publishing opt-in to control when images are built and pushed to GHCR and Docker Hub. Tag releases still publish.
- **Cross-repository fixture**: hosted macOS acceptance runs only on manual dispatch from `main`. Keep the fixture token out of repository and organization secrets. On a plan that enforces environment restrictions, use the `native-workspace-acceptance` environment with access limited to the `main` branch, require review where supported, and store `NATIVE_CODE_REPO_TOKEN` there with read-only access to the fixture repository. Set `NATIVE_CODE_REPOSITORY` if the fixture repository has moved.
- **Rulesets / protected branches** are unavailable for private repos on Free. The `test` aggregation job remains advisory; enforcement needs Team or a manual merge policy.

## Cost posture

- GitHub-hosted standard runners only; no self-hosted runner is referenced.
- Superseded runs are canceled where the replacement provides equivalent coverage. Each main push and full-history secret audit scans independently.
- Native acceptance reports its unverified status on PRs that change `e2e/byom/**` or the workflow itself. Hosted macOS tests require an explicit dispatch. Windows packaging is path-filtered to `desktop/**`.
- Artifact retention is 1–7 days; Docker digests are retained one day.

## Owner action before privatizing

1. For PRs affecting native acceptance, review the exact proposed revision before running both [native acceptance variants](../e2e/byom/README.md) on a trusted Mac with the pinned fixture revision. Record the tested SHA and result in the PR before merging. On GitHub Free private repositories, use this local procedure because the protected environment and its secret are unavailable. Remove any repository or organization copy of the fixture token before enabling this workflow. A successful `Native workspace acceptance not verified` job reports that the hosted macOS tests did not run; it does not satisfy the acceptance requirement.
2. Arrange a manual npm release approval process: have an independent reviewer record approval for the exact release commit in the release PR. An authorized maintainer dispatches the publish workflow on `main` only while that commit is its tip and confirms the run used the approved SHA. Verify the npm trusted publisher configuration and identify any dependency on environment secrets before cutover. If a run is canceled, check the registry version and run SHA before retrying: a canceled run can already have published. If manual approval is insufficient, keep the repository public until an enforceable release gate is in place.
3. Enable `ALLOW_IMAGE_PUBLISH=true` only if automatic main-branch builds and pushes to both registries are wanted.
4. In [GitHub billing settings](https://docs.github.com/en/billing/how-tos/set-up-budgets), set a separate $0 budget for each relevant metered product (for example, Actions and Packages), scoped to the account or organization that pays for this repository. Enable **Stop usage when budget limit is reached** for each budget that offers it. If a product cannot be capped, keep its paid usage disabled. Alerts alone do not stop charges.

<!-- /coderabbit-ai-generated:v1 -->
