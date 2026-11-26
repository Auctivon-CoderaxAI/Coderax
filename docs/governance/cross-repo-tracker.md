# Cross-repository governance tracker

One page for branch protection, CI state and security posture across the three public repositories.
Every field says how it was obtained. A field marked **unverified** was not readable from the
session that wrote this page; it is not a claim that the value is empty or safe.

Last updated: 2026-11-26.

## How this snapshot was obtained

| Source | Used for | Status |
|---|---|---|
| `git ls-remote https://github.com/Auctivon-CoderaxAI/<repo>` | default branch, main SHA, branch list, open PR numbers and head SHAs | Verified |
| Anonymous `git clone` of WorkflowEngine and CLI | public visibility, workflow audits | Verified |
| Static audit of `.github/workflows/**` and the working tree | permissions, triggers, secret references, credential-shaped literals, filesystem paths | Verified |
| GitHub REST API (`/actions/runs`, `/branches/main/protection`, `/actions/secrets`, `/orgs/...`) | check conclusions, approvals, protection config, secret names | **Unverified — not read** |

The REST API was not available: this session had no GitHub token, and the unauthenticated quota for
the shared egress address was exhausted (60/60) for the whole window. Nothing below infers CI
conclusions from a green-looking commit message or a merged pull request.

To fill the unverified rows, run the commands in
[Owner steps](#owner-steps-that-require-api-access) with an authenticated `gh`.

## Repository state

| Repository | Default branch | `main` SHA | Visibility | Anonymous read |
|---|---|---|---|---|
| `Coderax` | `main` | `a5d237b0ff672356374849d565363955df69d298` | public | yes |
| `Coderax-WorkflowEngine` | `main` | `808dfd3797f9b1d7647ebd14bd395806fc4ab9bd` | public | yes |
| `CoderaxCLI` | `main` | `1b7c8e0a429755502f7563b16a8a09db899452d8` | public | yes |

Public visibility is inferred from an unauthenticated `git clone` succeeding for all three
repositories; a private repository cannot be cloned anonymously.

## Open pull requests

Head SHAs are the exact SHAs a branch rule would evaluate. They move, so treat the SHA as a
snapshot and re-read it before acting.

| Repo | PR | Branch | Exact head SHA | Exact-head CI | Independent approval |
|---|---|---|---|---|---|
| Coderax | [#308](https://github.com/Auctivon-CoderaxAI/Coderax/pull/308) | `revert-307-freebuff/coderax-chat-and-work-ui-implementation` | `3d9b0e55d5189d48c42c982ac93c962e5a0cd6bf` | **unverified** | **unverified** |
| Coderax | [#309](https://github.com/Auctivon-CoderaxAI/Coderax/pull/309) | `fix/worker-keep-vars` | `46ba346f1b00c418de02e3d10bc1ef5c57fcf72b` | **unverified** | **unverified** |
| Coderax | [#310](https://github.com/Auctivon-CoderaxAI/Coderax/pull/310) | `dependabot/npm_and_yarn/i18next-26.3.4` | `777c3f7f06109fd4d27b2b8335cd269264c123bd` | **unverified** | **unverified** |
| Coderax | [#311](https://github.com/Auctivon-CoderaxAI/Coderax/pull/311) | `perf/stable-query-client` | `d435e94875ff40ff4e9b57184334857b0352b112` | **unverified** | **unverified** |
| Coderax | [#312](https://github.com/Auctivon-CoderaxAI/Coderax/pull/312) | `test/ui-evidence` | `b80b5799f728b237ff636126f4b26c9bafc3575a` | **unverified** | **unverified** |
| Coderax | [#313](https://github.com/Auctivon-CoderaxAI/Coderax/pull/313) | `fix/work-composer-controls` | `094bdd98e6d64dd61caddbd9ea60ab908bb12842` | **unverified** | **unverified** |
| WorkflowEngine | [#2](https://github.com/Auctivon-CoderaxAI/Coderax-WorkflowEngine/pull/2) | `feat/intelligence-core` | `2072df89093e09ff8248a5ea416c9476da9c8dde` | **unverified** | **unverified** |
| CLI | — | — | — | — | — |

`CoderaxCLI` has no open pull request. One open merge ref exists at PR 2 on WorkflowEngine and none
on CLI.

## Branch ownership

Branches with no open pull request. Per contributor policy these are short-lived and should be
deleted once their pull request is closed; a preserved branch is a deliberate exception and needs a
stated reason.

| Repo | Branch | Head SHA | Assessment |
|---|---|---|---|
| Coderax | `docs/design-architecture-v1.1` | `815b0c3f9f5be07573064efa7c03661b27e23fcc` | no open PR — candidate for deletion |
| Coderax | `docs/design-architecture-v2` | `094a751f8b3ac94ecc173f5abf172b56d7f78b75` | no open PR — candidate for deletion |
| Coderax | `fix/shared-baseline-ci` | `c1841ac95cc6dc3e96f5019ce5ac7cab421670d8` | no open PR — overlaps this CI work; reconcile before deleting |
| Coderax | `freebuff/5616a8422f78852540bdb2e5` | `fb8d35c5e143bbfd824ac72bcc41152e81e351c1` | session branch, no open PR |
| Coderax | `freebuff/b88a45eb6883ae25c58b6451` | `4a51301517a9bf13636754ce09d303295dcba113` | session branch, no open PR |
| Coderax | `freebuff/coderax-chat-and-work-ui-implementation` | `d94892df8fbde484c7556973f5ed3f71c5d66423` | PR #307 already merged, PR #308 reverts it |
| Coderax | `preserve/audit-20261123/*` (5 branches) | see `git ls-remote` | explicit preservation branch; keep |

## Verification gate status

| Repo | Gate | Status |
|---|---|---|
| Coderax | `CI Gate / Aggregate gate` | workflow added, self-tested locally; first hosted run **unverified** |
| Coderax | Actions on GitHub-hosted runners | **unverified** — `ci-canary.yml` is the canary and has not been run |
| WorkflowEngine | `verify` workflow | **unverified** |
| WorkflowEngine | Branch protection | **unverified** — see the stale-blocker note below |
| CLI | `ci` workflow | **unverified** |

### Stale blocker on WorkflowEngine

`Coderax-WorkflowEngine/.github/MAIN_BRANCH.md` records that the plan returns HTTP 403 for
`branches/main/protection` and `rulesets` with "Upgrade to GitHub Pro or make this repository
public". That message is what GitHub returns for a **private** repository on a free plan. The
repository is now publicly clonable, and branch protection and rulesets are available at no cost on
public repositories. The recorded conclusion is therefore very likely stale and should be re-tested
rather than repeated as the reason protection cannot be enforced. At $0 spend the answer is
visibility plus a ruleset on the public repository, not a plan upgrade.

## Security findings — static audit

Verified against the working tree and `.github/workflows/**`. Nothing here requires reading a secret
value.

### Fixed on this branch

| Finding | Location | Change |
|---|---|---|
| Personal absolute filesystem path committed | `redis-config/redis-tls.conf`, `redis-config/start-redis-tls.sh` | Replaced with paths resolved relative to the config directory; the launcher resolves its own directory |
| No top-level token scope | `.github/workflows/helmcharts.yml` | Added `permissions: contents: read`; the publishing job keeps `packages: write` |
| Reviewer request named an upstream account with no access to this organization | `.github/workflows/locize-i18n-sync.yml` | Points at the repository code owner, so the run stops failing on an unknown reviewer |
| Required check could be permanently pending | branch rule design | Single always-reporting `CI Gate / Aggregate gate`; see `.github/MAIN_BRANCH.md` |

### Open findings

| ID | Finding | Severity | Owner decision |
|---|---|---|---|
| S1 | Same-repository `pull_request` runs receive real secrets (`CODERAX_URL`, `CODERAX_TOKEN`, `MONGO_URI`, `OPENAI_API_KEY`, `JWT_SECRET`, `CREDS_KEY`, `CREDS_IV`). A branch pushed by anyone with write access can edit the workflow file in the same run that receives them. Fork pull requests are unaffected: `secrets.*` resolves empty for them. | Medium | Move the secret-bearing steps behind an `environment` with required reviewers, or gate them to `push` on `main`. Not changed here because it alters what the suites can test. |
| S2 | `CODERAX_SMOKE_EMAIL` / `CODERAX_SMOKE_PASSWORD` exist as repository secrets for a deployment smoke account. A smoke account with a password is a standing credential. | Low | Replace with a short-lived token issued per run, or restrict the account. |
| S3 | `retry-docker-builds.yml` uses `workflow_run`, which runs with base-repository privileges and `actions: write`. It never checks out or executes pull-request content and verifies the run is still current before re-running. | Low, by construction | Keep the "never execute PR content" property: no `actions/checkout` of the triggering head, ever. |
| S4 | `sync-helm-chart-tags.yml` holds `contents: write` and `actions: write` and constructs a basic-auth header from `GITHUB_TOKEN` inside a shell step. | Low | Acceptable: `workflow_dispatch` and `main` push only, no pull-request trigger. Never add a pull-request trigger to this workflow. |
| S5 | The committed personal path still exists in history at commit `5beb0984` ("Initial Coderax source"). | Informational | No credential is involved, so no history rewrite is warranted. Record and move on. |
| S6 | `.github/FUNDING.yml` declares `github: [danny-avila]`, and `.github/CONTRIBUTING.md` links the upstream contributor's roadmap project and the `Coderax-AI/Coderax` discussions board. On this organization's repository both route users and money to an unrelated upstream party. | Medium | Owner decision, not a code fix: remove the funding declaration or point it at the organization, and repoint the contribution links. Left unchanged here because it is an ownership decision rather than an engineering one. |

### Verified clean

- **No `pull_request_target` anywhere**, and no `issue_comment`, `repository_dispatch` or
  `workflow_run` path that checks out untrusted pull-request code. The only `workflow_run` is S3.
  `repository_dispatch` in `locize-i18n-sync.yml` requires write access to trigger.
- **No real credential literal in the tree.** Every `sk-…`, `ghp_…`, `AKIA…` and `eyJ…` string found
  is a deliberate fixture for a redaction test (`client/src/lib/rum/redact.spec.ts`,
  `packages/security-lab-core/test/core.test.js`, `packages/api/src/autobuild/verify.spec.ts`,
  `client/src/lib/rum/redact.spec.ts` and the Anthropic key-prefix tests). Those fixtures must look
  like credentials for the redactor to be exercised, and replacing them with `REDACTED` would delete
  the test. `.env.example`'s `-----BEGIN PRIVATE KEY-----` is already an unambiguous placeholder.
- **OIDC is scoped.** `id-token: write` appears only in the three npm publish workflows, only on the
  `publish` environment, only reachable by `workflow_dispatch` on `main`.
- **Deployment credentials are not reachable from a pull request.** `DOCKERHUB_USERNAME` and
  `DOCKERHUB_TOKEN` appear only in `push`, `tag` and `workflow_dispatch` workflows.
- **No test fixture records a real personal filesystem path.** `/Users/operator/…` and
  `/home/user/…` are synthetic; they are left alone deliberately.

### Unverified

Organization secrets, repository secrets, environment secrets, deployment environments, published
artifacts and workflow run logs were **not** read. Zero repository secrets in a report would not
prove zero exposure either: a secret can leak through a committed value, a run log, an artifact, or a
`pull_request`-triggered workflow that interpolates it into a shell step.

## Verified check-name register

Every pull-request-triggered check in Coderax, as `<workflow name> / <job name>`. 21 workflows, 43
check names. This register is generated from the workflow files; regenerate it after adding a job
rather than typing a name into the branch rule.

| Workflow | Job name | Check |
|---|---|---|
| `Lint for accessibility issues` | `axe-linter` | `Lint for accessibility issues / axe-linter` |
| `Integration Tests` | `Integration Tests (MongoDB and Redis)` | `Integration Tests / Integration Tests (MongoDB and Redis)` |
| `Backend Unit Tests` | `Build packages` | `Backend Unit Tests / Build packages` |
| `Backend Unit Tests` | `Codegraph select` | `Backend Unit Tests / Codegraph select` |
| `Backend Unit Tests` | `TypeScript type checks` | `Backend Unit Tests / TypeScript type checks` |
| `Backend Unit Tests` | `Circular dependency checks` | `Backend Unit Tests / Circular dependency checks` |
| `Backend Unit Tests` | `Tests: api (shard <n>/3)` | `Backend Unit Tests / Tests: api (shard <n>/3)` |
| `Backend Unit Tests` | `Tests: data-provider` | `Backend Unit Tests / Tests: data-provider` |
| `Backend Unit Tests` | `Tests: data-schemas` | `Backend Unit Tests / Tests: data-schemas` |
| `Backend Unit Tests` | `Tests: @coderax/api (shard <n>/4)` | `Backend Unit Tests / Tests: @coderax/api (shard <n>/4)` |
| `Cache Integration Tests` | `Integration Tests that use actual Redis Cache` | `Cache Integration Tests / Integration Tests that use actual Redis Cache` |
| `CI Gate` | `Aggregate gate` | `CI Gate / Aggregate gate` |
| `Validate cloud-only deployment files` | `validate` | `Validate cloud-only deployment files / validate` |
| `Codegraph Select (observe)` | `select` | `Codegraph Select (observe) / select` |
| `Coderax deployment readiness` | `Validate the Cloudflare build and release contract` | `Coderax deployment readiness / Validate the Cloudflare build and release contract` |
| `Coderax API proxy and free-host contracts` | `contract` | `Coderax API proxy and free-host contracts / contract` |
| `Coderax self-hosted deployment validation` | `Full-stack Compose and Express route gate` | `Coderax self-hosted deployment validation / Full-stack Compose and Express route gate` |
| `Copilot Code Review` | `copilot-setup-steps` | `Copilot Code Review / copilot-setup-steps` |
| `Coderax Desktop Release` | `Build Windows installer` | `Coderax Desktop Release / Build Windows installer` |
| `Coderax Desktop Release` | `Publish desktop release` | `Coderax Desktop Release / Publish desktop release` |
| `Docker Build Smoke Tests` | `Codegraph select` | `Docker Build Smoke Tests / Codegraph select` |
| `Docker Build Smoke Tests` | `Build Docker client package target` | `Docker Build Smoke Tests / Build Docker client package target` |
| `Docker Build Smoke Tests` | `Node image smoke (plain Dockerfile builds)` | `Docker Build Smoke Tests / Node image smoke (plain Dockerfile builds)` |
| `Docker Build Smoke Tests` | `API runtime smoke (production image boots)` | `Docker Build Smoke Tests / API runtime smoke (production image boots)` |
| `Frontend Unit Tests` | `Client build recovery regression` | `Frontend Unit Tests / Client build recovery regression` |
| `Frontend Unit Tests` | `Codegraph select` | `Frontend Unit Tests / Codegraph select` |
| `Frontend Unit Tests` | `Build packages` | `Frontend Unit Tests / Build packages` |
| `Frontend Unit Tests` | `TypeScript type checks (client)` | `Frontend Unit Tests / TypeScript type checks (client)` |
| `Frontend Unit Tests` | `Tests: @coderax/client` | `Frontend Unit Tests / Tests: @coderax/client` |
| `Frontend Unit Tests` | `Tests: Ubuntu (shard <n>/2)` | `Frontend Unit Tests / Tests: Ubuntu (shard <n>/2)` |
| `Frontend Unit Tests` | `Vite build verification` | `Frontend Unit Tests / Vite build verification` |
| `Langfuse Fanout` | `Go tests` | `Langfuse Fanout / Go tests` |
| `Lighthouse CI` | `lighthouse` | `Lighthouse CI / lighthouse` |
| `Bombadil Property Exploration` | `bombadil` | `Bombadil Property Exploration / bombadil` |
| `Playwright E2E Tests` | `Codegraph select` | `Playwright E2E Tests / Codegraph select` |
| `Playwright E2E Tests` | `e2e (<matrix name>)` | `Playwright E2E Tests / e2e (<matrix name>)` |
| `Playwright E2E Tests` | `MCP list_changed (replica count <n>)` | `Playwright E2E Tests / MCP list_changed (replica count <n>)` |
| `Playwright E2E Tests` | `MCP Apps (browser and server)` | `Playwright E2E Tests / MCP Apps (browser and server)` |
| `Playwright E2E Tests` | `e2e` | `Playwright E2E Tests / e2e` |
| `Portfolio Agent Registry` | `Validate repository-agent registry contracts` | `Portfolio Agent Registry / Validate repository-agent registry contracts` |
| `Static Checks` | `Static checks` | `Static Checks / Static checks` |
| `Static Checks` | `ESLint config regression sweep` | `Static Checks / ESLint config regression sweep` |
| `Native Workspace Acceptance` | `Machine choices and saved chat transitions (macOS)` | `Native Workspace Acceptance / Machine choices and saved chat transitions (macOS)` |

Matrix-expanded names are shown with `<n>` because the literal template string
`Tests: api (shard ${{ matrix.shard }}/3)` is never a real check name. Pick the name from an actual
run.

## Integration dependencies

| Dependency | Consumers | Note |
|---|---|---|
| `packages/data-provider` build | `packages/api`, `client`, `packages/client` | Must be built before their typechecks; every affected workflow restores it from cache keyed on its `src/**` |
| `packages/data-schemas` build | `packages/api` tests | Same cache-key pattern |
| MongoDB + Redis services | `agents-integration-tests`, `cache-integration-tests` | Service containers, not secrets |
| `worker`/`wrangler.jsonc` contract | `coderax-deployment-readiness`, `cloudflare-production` | Deploy contract validated on PR, verified on `main` push |
| `verify` workflow | WorkflowEngine `main` | Single workflow, no path filter, so its required check cannot go pending |
| `ci` workflow | CLI `main` | Single workflow, no path filter |

Both satellite repositories already have the property Coderax was missing: one unfiltered workflow,
so one required check that always reports.

## Owner steps that require API access

These were **not** performed. They need an authenticated owner; none of them costs money.

### Rerun previously billing-blocked workflows

```bash
gh auth status

# The canary proves a hosted runner starts at all. One executed step is the bar.
gh workflow run ci-canary.yml --repo Auctivon-CoderaxAI/Coderax
gh run list --workflow ci-canary.yml --repo Auctivon-CoderaxAI/Coderax --limit 5

# Re-run the most recent failed run of each gate once the canary is green.
gh run list --repo Auctivon-CoderaxAI/Coderax --status failure --limit 50 \
  --json databaseId,name,headSha,conclusion
gh run rerun <RUN_ID> --failed --repo Auctivon-CoderaxAI/Coderax

# WorkflowEngine and CLI
gh run list --repo Auctivon-CoderaxAI/Coderax-WorkflowEngine --limit 5
gh run list --repo Auctivon-CoderaxAI/CoderaxCLI --limit 5
```

`startup_failure` with `steps=0` is the billing or spending-limit signature documented in
`docs/CI-UNBLOCK.md`. A job that starts and executes a step is the only evidence the allowance
works; a green badge on a stale run is not.

### Secret scanning and push protection

Public repositories get secret scanning and push protection at no cost. Enable for the organization
so new repositories inherit it:

```bash
gh api --method PATCH /orgs/Auctivon-CoderaxAI \
  -f 'security_and_analysis[secret_scanning][status]=enabled' \
  -f 'security_and_analysis[secret_scanning_push_protection][status]=enabled'

for repo in Coderax Coderax-WorkflowEngine CoderaxCLI; do
  gh api --method PATCH /repos/Auctivon-CoderaxAI/$repo \
    -f 'security_and_analysis[secret_scanning][status]=enabled' \
    -f 'security_and_analysis[secret_scanning_push_protection][status]=enabled' \
    -f 'security_and_analysis[secret_scanning_push_protection_custom_link_enabled]=true'
done
```

UI equivalent: **Settings → Code security and analysis → Secret scanning → Enable**, then
**Push protection → Enable**. At organization level: **Organization settings → Code security →
Code security configurations**, and set the configuration as the default for new repositories.

Read the alerts without printing any secret value:

```bash
for repo in Coderax Coderax-WorkflowEngine CoderaxCLI; do
  echo "== $repo"
  gh api "/repos/Auctivon-CoderaxAI/$repo/secret-scanning/alerts?state=open" \
    --jq '.[] | {number, state, secret_type, path: .secret_scanning.secret_type_display_name}'
done
```

### Branch protection and rulesets

A ruleset on `main`, keeping every rule the contributor policy names. Independent approval comes
from a second collaborator; public repositories include unlimited free collaborators.

```bash
gh api --method POST /repos/Auctivon-CoderaxAI/Coderax/rulesets --input - <<'JSON'
{
  "name": "main protection",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "required_linear_history" },
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": true,
        "require_last_push_approval": true,
        "required_review_thread_resolution": true,
        "allowed_merge_methods": ["merge", "squash", "rebase"]
    }},
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": true,
        "do_not_enforce_on_create": false,
        "required_status_checks": [
          { "context": "CI Gate / Aggregate gate" }
        ]
    }}
  ]
}
JSON
```

Administrator enforcement is the ruleset `"enforcement": "active"` plus the bypass list being empty.
Do not add a bypass actor to unblock a merge; there is nothing to bypass for, because the gate always
reports.

Verify what the platform actually stores, rather than what was requested:

```bash
gh api /repos/Auctivon-CoderaxAI/Coderax/rulesets --jq '.[] | {id, name, enforcement}'
gh api /repos/Auctivon-CoderaxAI/Coderax/rulesets/<RULESET_ID> --jq '.rules'
# A single required check must be the only entry here.
gh api /repos/Auctivon-CoderaxAI/Coderax/branches/main/protection \
  --jq '{checks: .required_status_checks.contexts, reviews: .required_pull_request_reviews, admins: .enforce_admins.enabled}'
```

Classic protection is the fallback where rulesets are unavailable:

```bash
gh api --method PUT /repos/Auctivon-CoderaxAI/Coderax/branches/main/protection --input - <<'JSON'
{
  "required_status_checks": { "strict": true, "contexts": ["CI Gate / Aggregate gate"] },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": true,
    "required_approving_review_count": 1,
    "require_last_push_approval": true
  },
  "required_conversation_resolution": true,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
```

### Audit secrets and environments

Names only. Never echo a value.

```bash
gh api /orgs/Auctivon-CoderaxAI/actions/secrets --jq '.secrets[] | {name, visibility, updated_at}'
gh api /orgs/Auctivon-CoderaxAI/actions/variables --jq '.variables[] | {name, visibility}'

for repo in Coderax Coderax-WorkflowEngine CoderaxCLI; do
  echo "== $repo"
  gh api "/repos/Auctivon-CoderaxAI/$repo/actions/secrets" --jq '.secrets[] | {name, updated_at}'
  gh api "/repos/Auctivon-CoderaxAI/$repo/environments" --jq '.environments[] | {name, protection_rules}'
  for env in $(gh api "/repos/Auctivon-CoderaxAI/$repo/environments" --jq '.environments[].name'); do
    gh api "/repos/Auctivon-CoderaxAI/$repo/environments/$env/secrets" --jq '.secrets[] | {name}'
  done
done
```

Cross-check every name against the static audit: `CODERAX_URL`, `CODERAX_TOKEN`, `MONGO_URI`,
`OPENAI_API_KEY`, `JWT_SECRET`, `CREDS_KEY`, `CREDS_IV`, `BAN_VIOLATIONS`, `BAN_DURATION`,
`BAN_INTERVAL`, `NODE_MAX_OLD_SPACE_SIZE`, `CODERAX_SMOKE_*`, `DOCKERHUB_*`, `LOCIZE_*`,
`AXE_LINTER_API_KEY`. Any secret name that no workflow references is a candidate for revocation.

### Exact-head CI and approval status for the open pull requests

```bash
for pr in 308 309 310 311 312 313; do
  echo "== PR $pr"
  gh pr view "$pr" --repo Auctivon-CoderaxAI/Coderax \
    --json number,isDraft,headRefOid,reviewDecision,statusCheckRollup \
    --jq '{number, isDraft, headRefOid, reviewDecision,
           checks: [.statusCheckRollup[] | {name, status, conclusion}]}'
  gh api "repos/Auctivon-CoderaxAI/Coderax/pulls/$pr/reviews" --paginate \
    --jq '.[] | {user: .user.login, state, commit_id}'
done

gh pr view 2 --repo Auctivon-CoderaxAI/Coderax-WorkflowEngine \
  --json number,isDraft,headRefOid,reviewDecision,statusCheckRollup
```

An approval counts only when its `commit_id` equals the current `headRefOid`. A review of an earlier
head is not approval of what is there now.
