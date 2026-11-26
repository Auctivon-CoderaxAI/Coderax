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
- **npm provenance** requires a public source repository. Removed from the three manual publish workflows; the protected `publish` environment and npm OIDC trusted publishing remain.
- **GHCR storage**: private packages include 500 MB. Build cache moved from GHCR to the free 10 GB Actions cache, and automatic main-branch image publishing is gated behind `ALLOW_IMAGE_PUBLISH=true`. Tag releases still publish.
- **Cross-repository fixture**: set `NATIVE_CODE_REPO_TOKEN` (read-only) and optionally `NATIVE_CODE_REPOSITORY` before privatizing.
- **Rulesets / protected branches** are unavailable for private repos on Free. The `test` aggregation job remains advisory; enforcement needs Team or a manual merge policy.

## Cost posture

- GitHub-hosted standard runners only; no self-hosted runner is referenced.
- `concurrency` with `cancel-in-progress` covers repeated pushes.
- macOS acceptance is path-filtered to `e2e/byom/**`; Windows packaging to `desktop/**`.
- Artifact retention is 1–7 days; Docker digests are retained one day.

## Owner action before privatizing

1. Add `NATIVE_CODE_REPO_TOKEN`.
2. Decide whether `ALLOW_IMAGE_PUBLISH` should be enabled; if yes, monitor GHCR against 500 MB.
3. Add a $0 billing/spending limit so overage is refused.
