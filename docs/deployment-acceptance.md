# Coderax deployment acceptance record

This record distinguishes what was observed from what was assumed. A green build is not a deployment
check, and a reachable host is not a working application.

## Scope and revision

| Field | Value |
| --- | --- |
| Date (UTC) | 2026-11-25, probes at 05:08–05:16 |
| Repository | `Auctivon-CoderaxAI/Coderax` (private, default branch `main`) |
| Main revision | `7c9147e7460d6b2e987b7294da49c6a4c20293cd` |
| Cloudflare Worker | `coderax`, account `19f79492be7da82f6a48c2aea198ef92` |
| Cloudflare origin | `https://coderax.nnabdelshahid.workers.dev` |
| Vercel origin | `https://coderaxai.vercel.app` |
| Cloudflare build | `16b82ea0-a9a3-41b7-ad85-788255d0fa90` (check completed 05:05:56) |
| Cloudflare version | `5b30f22c-5cfe-42e7-9596-3eaf6e352f6a` |

## Results

| Requirement | Result | Evidence |
| --- | --- | --- |
| Correct GitHub repository connected | **Pass** | GitHub API reports `full_name: Auctivon-CoderaxAI/Coderax`, `private: true`, `default_branch: main`; the Cloudflare GitHub App check run is attached to this repository. |
| `main` is the sole persistent branch | **Partial** | No `dev`, `canary` or `dev-staging` branch exists, and every open PR targets `main`. Stale feature/archive branches remain; the merged migration branch is removed separately. Platform branch protection is unavailable: the private repository is on a plan that returns `403 Upgrade to GitHub Pro or make this repository public`. `.github/MAIN_BRANCH.md` records the required review process. |
| Cloudflare builds and deploys approved `main` changes automatically | **Pass** | `Workers Builds: coderax` check run `138992537016` concluded `success` at `head_sha: 7c9147e7…`; build `16b82ea0…`, version `5b30f22c…`. Deploy command is recorded in the build settings. |
| Build and deployment commands are correct | **Pass (configuration)** | Build: `npm ci`; build: `npm run frontend`; deploy: Wrangler. The Worker build produced assets and the Worker deployed successfully. The deploy command still needs the pinned `npm run deploy:cloudflare` setting in the Cloudflare dashboard (see [rollout gap](#rollout-gap)). |
| Wrangler configuration is committed and reproducible | **Pass** | [`wrangler.jsonc`](../wrangler.jsonc) is committed with the Worker name, entrypoint, asset directory, SPA fallback and `run_worker_first` routes; `workers_dev` is explicit. `scripts/verify-cloudflare-deployment.mjs --config-only` validates it. |
| Production URL serves the intended `main` revision | **Partial** | The Worker serves the SPA at the Cloudflare origin, and its build check is bound to the exact `main` SHA. Before this change the artifact carried no revision marker, so the served commit could not be proven from the live origin. `/deployment.json` now provides that proof on the next build; until then the requirement is unproven. |
| API traffic reaches the authorized cloud backend | **Fail on Cloudflare** | `GET /api/config`, `/readyz`, `/oauth/callback` and `/api/work/chat` on the Cloudflare origin returned `503` with `{"error":"API proxy is not configured"}`. `CODERAX_API_ORIGIN` and `CODERAX_PROXY_SECRET` are not set on the Worker. On Vercel, `/api/config` returned JSON and `/readyz` returned `OK`, so the OCI backend itself is reachable through the legacy proxy. |
| Failed deployments do not replace a working release | **Not tested live; behavior documented** | Workers Builds only switches versions after a successful build; a failed build leaves the previous deployment. The new gate polls `/deployment.json` for the merged commit and fails when the old version remains. No failed Cloudflare build was induced because this workspace has no Cloudflare credentials. |
| Rollback procedures documented and tested where safe | **Documented; live rollback not executed** | [`deploy/cloudflare/README.md`](../deploy/cloudflare/README.md) records dashboard and Wrangler rollback, the verification command, and the revert-PR follow-up. Configuration and unit checks run locally; a live version rollback requires an authenticated Cloudflare session. |
| Production verification cannot report success when checks were skipped | **Fail before this change; fixed in the repository** | The previous Vercel post-merge workflow exited `0` with a notice when deployment secrets were absent, and no Cloudflare verification existed. This change replaces it with a fail-closed Cloudflare gate and rejects `api: verified` without `deployment: verified`. |
| The new gate was executed | **Fail closed locally; hosted workflow not run** | `node scripts/verify-cloudflare-deployment.mjs --url https://coderax.nnabdelshahid.workers.dev --expected-commit 7c9147e7…` exited `1` with `/deployment.json is not JSON; the SPA fallback answered instead of a build artifact`. The GitHub workflow is committed but hosted Actions is billing-blocked on this repository, so it has not executed. A workflow that cannot start is not acceptance. |
| Existing data and owner-only authentication remain intact | **Partial** | Live `/api/config` reports `registrationEnabled: false`, `socialLoginEnabled: false`, `emailLoginEnabled: true`. No login was performed, so session continuity and stored conversations were not exercised. No database, schema or collection was changed. |
| No unauthorized charges are possible | **Partial** | No paid service, plan, add-on or resource is introduced; the Worker and Workers Builds stay on free allowances. Work routing remains the verified `$0` path in code and tests. Provider billing and Vercel/OCI account charges cannot be observed from this workspace. |
| No new workloads depend on Vercel | **Fail before this change; fixed in the repository** | `vercel-production.yml` deployed on every `main` push. It is removed, along with its workflow test, so merges no longer create Vercel workloads. The existing Vercel deployment is retained for rollback pending owner approval. |
| All migration-related PRs resolved and completed branches removed | **Partial** | PRs #285 (Worker assets/API routing), #298 (verification levels) and #300 (main-only branch policy) are merged. Open PRs #291 and #301 are engine/Work work, not migration. The merged `chore/main-only-branch-policy` branch is removed. Other stale branches predate this migration. |

## Live observations

Cloudflare origin, 2026-11-25:

```text
GET /                 -> 200 text/html   Coderax SPA
GET /login            -> 200 text/html   Coderax SPA
GET /c/new            -> 200 text/html   Coderax SPA
GET /api/config       -> 503 application/json  {"error":"API proxy is not configured"}
GET /readyz           -> 503 application/json  {"error":"API proxy is not configured"}
GET /oauth/callback   -> 503 application/json  {"error":"API proxy is not configured"}
GET /api/work/chat    -> 503 application/json  {"error":"API proxy is not configured"}
```

Vercel origin, 2026-11-25:

```text
GET /readyz           -> 200 text/plain  OK
GET /api/config       -> 200 application/json, appTitle: Coderax
GET /login            -> 200 text/html
server                -> Vercel; upstream responses include "via: 1.1 Caddy"
buildInfo.commit      -> missing
registrationEnabled   -> false
socialLoginEnabled    -> false
emailLoginEnabled     -> true
```

The missing `buildInfo.commit` is an acceptance failure, not a warning. The Vercel/OCI deployment
cannot identify the revision it is serving, so `verify-coderax-deployment.mjs --live-url` and the new
Cloudflare gate both fail closed.

## Rollout gap

The Cloudflare edge is deployed but not wired to the authoritative backend. The remaining owner
actions are exclusively Cloudflare/OCI settings, not repository code:

1. Set Worker `CODERAX_API_ORIGIN` to the OCI `https://coderax-<public-ip>.sslip.io` origin.
2. Set Worker secret `CODERAX_PROXY_SECRET` to the matching OCI `origin.env` value.
3. Add `coderax.nnabdelshahid.workers.dev` to the OCI `CODERAX_ALLOWED_HOSTS`; set
   `DOMAIN_CLIENT` / `DOMAIN_SERVER` to the Cloudflare origin; recreate the app container.
4. Change the Workers Builds deploy command to `npm run deploy:cloudflare` so Wrangler is pinned.
5. Run `node scripts/verify-cloudflare-deployment.mjs --url … --expected-commit <main>`; the API
   build must also report a full `buildInfo.commit` (`BUILD_COMMIT` must reach the OCI image).

Until steps 1–5 complete, `https://coderaxai.vercel.app` remains the working front door. It must not
be deleted without explicit owner approval.

## Decisions

- **Acceptance status: not granted.** The Cloudflare origin does not reach the application backend,
  and neither origin currently proves a full backend revision.
- **No rollback or retirement was performed.** Neither Cloudflare nor Vercel credentials exist in this
  workspace; the existing Vercel deployment is intentionally preserved.
- **No success was inferred from HTTP 200 alone.** The SPA returning 200 while every API route returns
  503 is recorded as a failure of the application check.
