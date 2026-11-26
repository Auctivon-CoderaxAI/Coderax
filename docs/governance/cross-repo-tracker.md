# Cross-repository tracker

Owner: repository governance and CI. Updated 2026-11-26 18:11 UTC.
Snapshot of the three public repositories in the `Auctivon-CoderaxAI` organization. Every SHA is
the exact head the status beside it belongs to; a status at an earlier head is not evidence for a
later one.

## Repositories

| Repository | Visibility | `main` SHA | Actions | Secret scanning | Push protection |
|---|---|---|---|---|---|
| `Coderax` | public | `a5d237b0ff672356374849d565363955df69d298` | enabled | enabled | enabled |
| `Coderax-WorkflowEngine` | public | `808dfd3797f9b1d7647ebd14bd395806fc4ab9bd` | enabled | enabled | enabled |
| `CoderaxCLI` | public | `1b7c8e0a429755502f7563b16a8a09db899452d8` | enabled | enabled | enabled |

Organization plan: **free**, two members (`nnabdelshahid` admin, `AICoderax`). Public repositories
get branch protection, secret scanning and push protection on this plan at no cost.

## Hosted Actions

GitHub-hosted runners execute on all three repositories as of 2026-11-26. The billing block that
ended every job within seconds on 2026-11-21 is gone; what remains is runner **capacity**, not
billing — a queued job is waiting for a slot, not failing.

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:1a66ef1e864a3fd1eb8842ded22f067ce550b3f1f8bf7fb2b81358fd8dd0f0b9 -->

| Repository | Evidence that hosted runners work |
|---|---|
| `Coderax` | PR #312 and #313 jobs were assigned runners and ran; "Build Docker client package target" succeeded. |
| `Coderax-WorkflowEngine` | `verify` succeeded in run 45869651614 at `2072df89093e09ff8248a5ea416c9476da9c8dde`. |
| `CoderaxCLI` | Re-dispatched run 44924568808 (attempt 2) was assigned a runner: `Set up job`, checkout, Set up Node and Syntax check all succeeded. |

<!-- /coderabbit-ai-generated:v1 -->

The 2026-11-21 `CoderaxCLI` failure was the billing signature (every step skipped, ~3s). The rerun
**reached the tests**, which is how the real defect below became visible.

## Open pull requests

| Repository | PR | Head SHA | Owner (branch) | Latest exact-head CI | Independent approval | Review findings |
|---|---|---|---|---|---|---|
| `Coderax` | [#314](https://github.com/Auctivon-CoderaxAI/Coderax/pull/314) `ci: aggregate required CI gate` | `00b8d05a32d0dd4aeed2aab4f6def750115b46f2` | this session (`freebuff/3dd95d103e2681b57d0a12f9`) | 19 checks created at 18:01, queued/running; `CI gate (aggregate)` **queued** | none | none raised yet |
| `Coderax` | [#312](https://github.com/Auctivon-CoderaxAI/Coderax/pull/312) `test(ci): Chat and Work evidence` | `b80b5799f728b237ff636126f4b26c9bafc3575a` | UI evidence session (`test/ui-evidence`) | queued since 17:57 UTC | none | 8 review comments, 4 conversation comments |
| `Coderax` | [#313](https://github.com/Auctivon-CoderaxAI/Coderax/pull/313) `fix(ui): fit Work composer controls` | `094bdd98e6d64dd61caddbd9ea60ab908bb12842` | UI session (`fix/work-composer-controls`) | Docker client target passed; tests and API smoke in progress | none | 4 conversation comments, 0 inline |
| `Coderax` | Dependabot: `i18next` 24.2.2 → 26.3.4 | — | `dependabot[bot]` | not captured | none | automated changelog only |
| `Coderax-WorkflowEngine` | [#2](https://github.com/Auctivon-CoderaxAI/Coderax-WorkflowEngine/pull/2) `feat(intelligence)` | `2072df89093e09ff8248a5ea416c9476da9c8dde` | engine session (`feat/intelligence-core`) | **`verify` success** (run 45869651614) | none | 4 conversation comments |
| `CoderaxCLI` | [#4](https://github.com/Auctivon-CoderaxAI/CoderaxCLI/pull/4) `test(cli): real newlines in Work SSE fixtures` | `093225927a4eab27b9b8460492e6d860c5c93c40` | this session (`ci/fix-work-sse-fixtures`) | **`test` success** (run 45873236965, 18:07 UTC) | none | none |

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:627c8727b89d70b9569621ba2d63b74bc4a8e8c2a7e03a08f9cc80619b7df43e -->

No pull request in any repository carries an independent approval. Independent review is still required before merging; required CI must also pass on the
current head. The **free** plan enforces required reviews on public repositories.

<!-- /coderabbit-ai-generated:v1 -->

## Required checks and branch protection

`Coderax` — configured 2026-11-26 on `main`:

| Rule | Value |
|---|---|
| Required check | `CI gate (aggregate)` (GitHub Actions, `app_id` 15368) |
| Strict (up-to-date head) | yes |
| Required approving reviews | 1 |
| Dismiss stale approvals | yes |
| Require approval of the last push | yes |
| Code-owner review | no — `CODEOWNERS` names the sole owner, so requiring it would deadlock |
| Conversation resolution | yes |
| Enforce for administrators | **yes** |
| Force pushes | blocked |
| Deletion | blocked |
| Push restriction | `nnabdelshahid` (unchanged) |

`Coderax-WorkflowEngine` — required check `verify`; `verify.yml` job id `verify`, no path filter,
runs on every pull request. Name matches the actual job.

`CoderaxCLI` — required check `test`; `ci.yml` job id `test`, no path filter, runs on every pull
request. Name matches the actual job.

### Known CI failures

| Repository | Check | Cause | State |
|---|---|---|---|
| `CoderaxCLI` | `test` | The two native-Work snapshot tests double-escaped the SSE frame terminator, so each fixture held the literal characters `\n\n` instead of a blank line. No frame boundary was found, the command correctly reported that nothing was streamed, and both tests failed asserting exit code 0. | **Fixed** in PR #4 — 85/85 locally on Node 24.22.1, and hosted `test` **succeeded** at `09322592` (run 45873236965). |

Before this change `Coderax` required **no status checks at all**, so no CI gate blocked a merge
and no path-filtered workflow could leave a pending check either. Requiring the component
workflows by name would have introduced that problem: `Static checks`, `Tests: Ubuntu`, `e2e`,
`Lighthouse`, `a11y` and the rest are path-filtered and produce no check run when their paths are
untouched. `CI gate (aggregate)` runs unconditionally and evaluates only the checks that exist, so
it aggregates without ever waiting on a workflow that will not run.

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:461baa969ebcca3b552c3b93b4d5f1e3c18d1de6aa52dbb4585297df5446c659 -->

## Security findings

| # | Finding | State |
|---|---|---|
| S1 | `Coderax-WorkflowEngine` and `CoderaxCLI` had secret scanning **and** push protection disabled on public repositories. | **Fixed** — both enabled 2026-11-26, verified in the API response. |
| S2 | Credential-shaped literals committed: `ghp_…` PAT in `mcp.spec.ts`, `ghp_…` in `verify.spec.ts`, `AKIA…` / `ghp_…` in `security-lab-core`, `AKIAIOSFODNN7EXAMPLE` in `redact.spec.ts`. Push protection would flag any of them. | **Fixed** in PR #314 — assembled at runtime, so the redaction tests still match the real formats. A repository-wide grep now returns nothing. |
| S3 | Organization defaults for **new** repositories leave secret scanning, push protection, Dependabot alerts and the dependency graph disabled. | **Owner step** — Settings → Code security: enable all four. |
| S4 | Organization does not require two-factor authentication. | **Owner step** — Settings → Authentication security → require 2FA. |
| S5 | Organization secrets could not be enumerated: the API returns `403 You must be an org admin or have the actions secrets fine-grained permission`. This is an authorization limit, not evidence that none exist. | **Blocked** — needs an org-admin token or the owner reading Settings → Secrets → Actions. |
| S6 | No repository secrets exist in any of the three repositories, and no environment secrets exist in `production` or `copilot` (both read as `total_count: 0`). Workflows reference `DOCKERHUB_*`, `CODEGRAPH_*`, `LOCIZE_*`, `OPENAI_API_KEY`, `MONGO_URI`, `CODERAX_SMOKE_*`, `AXE_LINTER_API_KEY`. The values available to those lanes are unknown because organization secrets could not be inventoried. | **Open** — availability unverified. Zero repository secrets does **not** establish zero credential exposure: organization secrets are a separate store, and that list is blocked (S5). |
| S7 | `retry-docker-builds.yml` uses `workflow_run` with `actions: write`. | **Reviewed, acceptable** — it never checks out pull-request code, only reads run metadata and re-runs the run id from the event, so an untrusted fork cannot execute code in the privileged context. |
| S8 | OIDC (`id-token: write`) appears only in the three npm publish jobs, each scoped to `environment: publish`. | **Correct** — no long-lived token, no OIDC in pull-request jobs. |
| S9 | `deployed-smoke.yml` reads production secrets under `environment: production`. | **Safe** — `schedule` and `workflow_dispatch` only; never triggered by a pull request, so a fork cannot reach it. |
| S10 | Third-party actions are pinned by tag (`actions/checkout@v5`, `docker/*@v4`, `dorny/paths-filter@v4`), and `sha_pinning_required` is `false` on all three repositories. | **Residual supply-chain risk** — `CoderaxCLI` pins by commit SHA; the other two do not. Enabling `sha_pinning_required` would break them, so pinning has to land first. |
| S11 | `pull_request_target` is not used anywhere. Default `GITHUB_TOKEN` is read-only and cannot approve pull requests, on all three repositories. | **Verified good.** |
| S12 | `helmcharts.yml` was the only workflow without a top-level `permissions:`. | **Fixed** — `contents: read` baseline. |

## Deployment readiness

| Repository | State |
|---|---|
| `Coderax` | PR #314 is pending independent review and a passing required CI gate. No repository secrets or `production` environment secrets were found; whether organization secrets let `deployed-smoke.yml` authenticate is unknown (S5). The three npm publish jobs depend on OIDC trusted publishing and the `publish` environment, which does not yet exist (it is created on first use). |
| `Coderax-WorkflowEngine` | `verify` green at `2072df89093e09ff8248a5ea416c9476da9c8dde`. No deployment workflow; engine is a library/service contract. |
| `CoderaxCLI` | `main` is red on a real test defect, not billing: the rerun reached the tests and failed two native-Work snapshot assertions. PR #4 fixes the fixtures; merging is what restores a green `main`. |

<!-- /coderabbit-ai-generated:v1 -->

## Integration dependencies

- `CoderaxCLI` ≥ `1b7c8e0a` targets the native Work SSE endpoint and cumulative stream handling from
  `Coderax`; a `Coderax` change to that stream is a `CoderaxCLI` release dependency. The 2-test
  failure on `CoderaxCLI` `main` sits in exactly that integration and must not be read as a
  `Coderax` defect — the parser is correct and the fixtures were malformed.
- `Coderax-WorkflowEngine` PR #2 raises `CONTRACT_VERSION` to 1.1.0 with additive operations only;
  `Coderax` consumes that contract, so the engine PR should land before `Coderax` adopts 1.1.0.
- The `CI gate` check must exist on `main` before it can be satisfied by a branch. PRs #312 and #313
  predate the workflow, so they need an update-from-`main` (which `strict` already requires) before
  their head will report it.

## Notes and limits

- Review-thread **resolution** state is not available through the available REST surface; only
  comment counts are. A GraphQL-capable token is needed to record which threads are still open.
- Exact-head CI status is a point-in-time reading. Re-read `gh pr checks <n>` before acting on it.
- This tracker is updated through reviewed pull requests only. Do not edit `main` directly.
