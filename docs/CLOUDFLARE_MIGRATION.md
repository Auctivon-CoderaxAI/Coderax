# Coderax frontend migration: Vercel → Cloudflare Workers

Canonical origin: **https://coderax.nnabdelshahid.workers.dev**

Legacy origin: **https://coderaxai.vercel.app** — still deployed, and must stay deployed until
the owner authorizes retirement in writing.

This migration moves only the frontend and its edge API route to the Cloudflare Worker at
[`worker/index.mjs`](../worker/index.mjs). The database-backed Express API, MongoDB data, model
routing, agents and schedules stay exactly where they are on the Oracle Always Free host. No
database was created, reset, migrated or reseeded.

## What the Worker does

| Request                                                      | Behaviour                                                                                    |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `/api`, `/api/*`, `/oauth/*`, `/health`, `/livez`, `/readyz` | Forwarded to the configured `CODERAX_API_ORIGIN` with the proxy secret, after the host gate. |
| Every other path                                             | Served from `client/dist` with the SPA fallback.                                             |

`wrangler.jsonc` runs the Worker first for those API paths so the SPA fallback can never answer an
API call with `index.html`. The Worker fails closed with `503` when the API origin is missing or is
not the Coderax `sslip.io` form, or when the proxy secret is absent or shorter than 32 characters.
It returns `421` when an API request arrives on a hostname not listed in
`CODERAX_ALLOWED_HOSTS`, which defaults to the canonical host. A nonempty list replaces that
default, so it must include the canonical host. Loopback hosts stay allowed for local `wrangler dev`.

## Invariants preserved

- **Owner-only runtime.** `PASSWORD_LOGIN_PASSWORD` enables password-only owner sign-in, and the
  guest endpoint is disabled both by `ENABLE_GUEST_ACCESS=false` and by the presence of that
  password. Registration, social registration and email login stay off. Guest accounts created
  before the password existed are not reissued; their refresh tokens expire within
  `REFRESH_TOKEN_EXPIRY` (7 days by default). Delete those users, or rotate the JWT secrets, only
  if immediate revocation is required — rotating them signs the owner out too, without touching
  data.
- **Existing data.** The API keeps the same `MONGO_URI`, the same `JWT_SECRET`,
  `JWT_REFRESH_SECRET`, `CREDS_KEY` and `CREDS_IV`, and the same volumes. Do not run
  `docker compose down -v`, `docker volume prune`, a database migration or a reseed.
- **Visual identity.** The deployed bundle is the same React app and the same assets; no theme,
  layout or copy was changed for the move.
- **Native agent architecture.** No agent, orchestration, Work, memory or schedule code changed.
- **CyVox independence.** `CYVOX_ADDON_ENABLED` remains `false`; Coderax keeps its own auth, data
  and orchestration boundary.
- **Cost.** The Worker runs on the free Workers plan. No paid compute, storage, domain or model
  route is introduced.

## Origin-dependent behaviour

| Concern                             | Current behaviour                                                                                                                                                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cookies                             | `refreshToken` and `token_provider` are host-only (no `Domain=`), `Secure`, `HttpOnly`, `SameSite=Strict`. Moving origin creates a new session; no cookie is shared or migrated.                                                                  |
| CORS                                | The API answers `cors()`; the real gate is `requireSameOrigin`, which trusts `DOMAIN_CLIENT`/`DOMAIN_SERVER` and also the request's own forwarded host. Both origins keep working during the transition.                                          |
| CSP                                 | The API's policy uses `'self'` and `https:`/`wss:` connect sources, so it does not name a hostname. The static SPA shell is served by the Worker exactly as Vercel served it, with no CSP of its own.                                             |
| Service worker                      | Registered per origin at scope `/`. The new origin gets a fresh precache; the old Vercel service worker cannot control it.                                                                                                                        |
| API routing                         | Worker allowlist above; `api/proxy.ts` remains the Vercel path.                                                                                                                                                                                   |
| OAuth callbacks                     | Social, OpenID and admin SSO are disabled. If one is enabled later, register the new redirect URIs at the provider: `/oauth/<provider>/callback` and `/api/admin/oauth/<provider>/callback` on the new origin, and set `DOMAIN_SERVER` to it.     |
| Passkeys                            | Disabled. If enabled later, pin `PASSKEY_RP_ID` and add the new origin to `PASSKEY_ORIGINS`; changing the RP ID invalidates existing passkeys.                                                                                                    |
| Password reset / verification links | Disabled: `ALLOW_PASSWORD_RESET=false` and registration is off, so no such link is issued. If enabled later, they use `DOMAIN_CLIENT`.                                                                                                            |
| Deployment verification             | `scripts/verify-coderax-deployment.mjs --live-url` currently accepts only the legacy Vercel alias; PR #302 adds the exact Cloudflare origin and its regression suite. Authenticated smoke runs remain restricted to the exact allowlisted origin. |

## Live state observed on 2026-11-25

- `https://coderax.nnabdelshahid.workers.dev` serves the built SPA (HTTP 200, `text/html`).
- Its API route answers `503 {"error":"API proxy is not configured"}` because the Worker secrets
  are not set. No data is reachable through it in this state.
- `https://coderaxai.vercel.app` still serves the app and API; `/api/config` reports
  `registrationEnabled: false`, `passwordLoginEnabled: true`.
- Anonymous requests to `/api/user`, `/api/convos`, `/api/projects`, `/api/memories`, `/api/files`,
  `/api/models`, `/api/agents`, `/api/schedules`, `/api/studio`, `/api/workflows`, `/api/search`,
  `/api/presets`, and `POST /api/work/chat`, `/api/agents/chat`,
  `/api/agents/v1/chat/completions` all return `401`.

The migration is therefore **not live-complete** until the two Worker secrets and the VM's public
origin are in place and both verification commands below pass.

## Pending companion changes

Two open pull requests own parts of the surrounding release plumbing and are not claimed as merged
by this document:

- **PR #302** adds the exact Workers origin to `scripts/verify-coderax-deployment.mjs --live-url`
  and its regression suite. Until it merges, that command rejects the Cloudflare origin before it
  reads `/readyz`.
- **PR #303** adds the `client/dist/deployment.json` revision marker, the fail-closed Cloudflare
  release gate and the removal of automatic Vercel deployments. Its `deploy/cloudflare/README.md`
  and `docs/deployment-acceptance.md` are the detailed acceptance record.

This cutover change is complementary: it owns the Worker host/client-IP hardening, the anonymous
access gate, the canonical Oracle origin defaults and the owner-only Compose contract.

## Owner handoff (secrets never go through chat)

These steps require the owner's Cloudflare dashboard and the Oracle host. Values must not be
pasted into a PR, issue, document or chat message.

1. **Worker secrets** — Cloudflare dashboard → Workers & Pages → `coderax` → Settings → Variables
   and Secrets, in Production:
   - `CODERAX_API_ORIGIN` = the `https://coderax-<public-ip>.sslip.io` origin from
     `deploy/oci/origin.env` (`CODERAX_API_HOST`).
   - `CODERAX_PROXY_SECRET` = the `CODERAX_PROXY_SECRET` value from the same file.
   - `CODERAX_ALLOWED_HOSTS` is optional; the Worker defaults to
     `coderax.nnabdelshahid.workers.dev`. A nonempty value replaces that default, so include the
     canonical host alongside any preview or custom hostnames.
     Redeploy the Worker after adding secrets if the dashboard does not apply them to the current
     version.
2. **API public origin** — on the Oracle host, in the Compose environment:
   - `CODERAX_PUBLIC_ORIGIN=https://coderax.nnabdelshahid.workers.dev`
     (`DOMAIN_CLIENT` and `DOMAIN_SERVER` derive from it; the Compose `environment:` block takes
     precedence over `app.env`, so update the value Compose actually receives).
     Keep `PASSWORD_LOGIN_PASSWORD`, `ALLOW_REGISTRATION=false`, `ALLOW_SOCIAL_REGISTRATION=false`,
     `ENABLE_GUEST_ACCESS=false` and the existing `JWT_*`/`CREDS_*` values unchanged. Set
     `BUILD_COMMIT` to the full 40-character commit of the deployed source (and optionally
     `BUILD_BRANCH=main`) so `/api/config` can identify the revision; without it the release gate
     fails as unverified even when the deployment is healthy.
     In `deploy/oci/origin.env`, set `CODERAX_PUBLIC_HOST=coderax.nnabdelshahid.workers.dev` so Caddy
     forwards the new host for the direct Work stream path.
3. **Restart without touching data**:
   ```sh
   docker compose -f deploy/oci/compose.yaml up -d app web
   ```
   Never add `-v`, and never remove the Mongo volume.
4. **Sign in** — open `https://coderax.nnabdelshahid.workers.dev/login?manual=1` and enter the
   existing owner password. The session is new because cookies are host-only; this is expected.
5. **Verify**:
   ```sh
   node scripts/verify-coderax-deployment.mjs --live-url https://coderax.nnabdelshahid.workers.dev
   node scripts/verify-coderax-access.mjs --base-url https://coderax.nnabdelshahid.workers.dev
   ```
   The first requires a full 40-character `buildInfo.commit`. The second checks the public
   registration and password sign-in flags and requires `401`/`403` on the listed private routes.
   It creates no session; the public config does not report whether guest access is enabled.
   Before accepting the cutover, check the running OCI application's effective settings: guest
   access and registration (including social registration) are off, the owner password is set,
   and other sign-in methods are disabled unless explicitly authorized. Do not print secrets.
   Confirm owner sign-in succeeds and that any valid non-owner identity for a configured sign-in
   method is denied a Coderax session. If there is no other configured method, confirm this from
   the running configuration; an anonymous probe cannot establish which identities can sign in.
6. **Verify data in the UI** — recent conversations, projects and files, persistent memory, Work
   history, saved settings, agent configurations, authorized integrations, scheduled tasks and
   generated artifacts. The backend did not move, so any absence is a defect, not a migration
   step that should be "fixed" by resetting anything.
7. **Retirement is separate.** Do not remove the Vercel project, its domain or its proxy variables
   until the owner explicitly authorizes it after step 6.

## Verification record (2026-11-26)

Probes from a cloud workspace. Values are observed, not inferred.

| Check                  | Observation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Served Worker revision | `/deployment.json` reports `{"worker":"coderax","commit":"a5d237b0ff672356374849d565363955df69d298","branch":"HEAD","builtAt":"2026-11-25T22:59:12.475Z"}`; `/` and `/login` return HTML.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `main`                 | `a5d237b0ff…`, the same commit the Worker serves. The Worker is **not** stale relative to `main`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| PR #309                | Open, not merged. Its head is `46ba346f` and it adds `keep_vars: true`; `main` does not contain that setting. An earlier report that it had merged was wrong.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| API proxy              | `/readyz`, `/health`, `/livez`, `/api/config` and `/api/work/readiness` all return `503 {"error":"API proxy is not configured"}`. The Worker checks the proxy configuration before health handling, so a health route cannot report readiness while forwarding is disabled.                                                                                                                                                                                                                                                                                                                                                                                     |
| Cause of the 503       | `CODERAX_API_ORIGIN` is absent or not a valid `https://coderax-<ip>.sslip.io` origin, and/or `CODERAX_PROXY_SECRET` is absent or shorter than 32 characters. Both conditions return the same message, and no Cloudflare credential was available to distinguish them.                                                                                                                                                                                                                                                                                                                                                                                           |
| Cloudflare integration | Account and user endpoints fail with `6003/6103 Invalid format for X-Auth-Key header`; a Workers listing with a placeholder account returns `9106 Authentication failed`; zone listing succeeds but returns zero zones. The connector cannot authenticate account-scoped reads, so Worker settings, bindings, deployment history, build logs and the GitHub build trigger could not be inspected. This is an authentication-format defect, not proof of missing permissions. Re-confirmed at 19:50 UTC: `CLOUDFLARE_LIST_ACCOUNTS` returns the same `6003` wrapping `6103`, so every account-scoped tool in this connection fails before it reaches the Worker. |
| Vercel integration     | Authenticated as `nnabdelshahid@gmail.com` (`limited: true`); project and deployment listings return zero entries and team listing returns `403`. The `coderaxai` project and its origin variables are therefore not visible through this connection.                                                                                                                                                                                                                                                                                                                                                                                                           |
| Backend reachability   | Through `https://coderaxai.vercel.app`: `/readyz` returns `200 OK`, `/api/config` returns JSON, and upstream headers include `via: 1.1 Caddy` and `x-powered-by: Express`. A Caddy-fronted Express API is serving, but this does **not** prove the backend runs on Oracle.                                                                                                                                                                                                                                                                                                                                                                                      |
| Backend revision       | `/api/config` has no `buildInfo.commit`, so the release gate cannot identify the API revision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Oracle origin          | No Oracle integration is connected, and no origin is recorded in the repository or Git history; only reserved test fixtures (`coderax-93-184-216-34.sslip.io`) exist. No value can be supplied from the workspace, and no probe was sent to a guessed address.                                                                                                                                                                                                                                                                                                                                                                                                  |
| Oracle Always Free     | Not verifiable without the OCI console. Oracle publishes 1,500 OCPU hours and 9,000 GB hours per month (equivalent to 2 OCPUs and 12 GB of A1) and 200 GB of block storage; the runbook's 2 OCPU, 12 GB, 50 GB target is inside that allowance.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Streaming              | The Worker forwards `request.body` and returns `response.body` unread, and Caddy uses `flush_interval -1`. Cloudflare documents no wall-clock limit for an HTTP Worker while the client stays connected, so SSE is not cut at Vercel Hobby's 60 seconds. The exposed limit is the origin's time to first byte.                                                                                                                                                                                                                                                                                                                                                  |
| Database persistence   | `/readyz` `OK` through Vercel implies the boot-time database connection succeeded. No authenticated request was made, so conversation, memory and project persistence is unverified.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Work runtime           | `deploy/oci/coderax.oci.yaml` sets `engines.opencode.baseURL: http://opencode:4096`, but `main`'s Compose file had no `opencode` service, private `engine` network or shared engine volumes. Work could not reach its engine. This branch restores them from `930043e4`; the image was not built here because Docker is unavailable.                                                                                                                                                                                                                                                                                                                            |
| DeploymentPlatformAI   | No interface, adapter, endpoint or credential exists in this repository. Zero-cost hosting cannot be verified, and no infrastructure was created.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

### Second pass (2026-11-26, 19:20 UTC)

| Check                 | Observation                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Served Worker         | Unchanged: `/deployment.json` still reports `a5d237b0ff…`, built `2026-11-25T22:59:12.475Z`. `/readyz`, `/health`, `/livez` and `/api/config` still return `503 {"error":"API proxy is not configured"}`.                                                                                                                                                                                       |
| `main` and PR #309    | `main` is still `a5d237b0`; PR #309 is still **open** at `46ba346f`, `mergeable_state: unstable`, 4 commits, 7 files. It carries `keep_vars`, the OpenCode transport admission fix and the Worker config gate.                                                                                                                                                                                  |
| Repository visibility | Public (`private: false`). The three source repositories are public so standard hosted runners are free.                                                                                                                                                                                                                                                                                        |
| Hosted Actions        | Executing. 10,726 runs exist; `workflow_run` jobs on `a5d237b0` succeeded between 17:24 and 19:18 UTC, and pull-request runs for active branches were queued at 19:18 UTC. The earlier "billing-blocked" statement is stale.                                                                                                                                                                    |
| PR #309 checks        | 42 check runs; only Workers Builds and CodeRabbit succeeded. The failures are stale, not diagnostic: jobs at 06:19 UTC show `started_at == completed_at` within two seconds, `steps: []` and no annotations, which is the signature of a runner that never started. They must be re-run at the current head.                                                                                    |
| Workers Builds        | The Cloudflare GitHub integration reports `Workers Builds: coderax` **success** on `46ba346f` and publishes preview builds. The production Worker still serves `a5d237b0` because #309 is unmerged.                                                                                                                                                                                             |
| Cause of the 503      | At least one of the two Worker checks fails: `CODERAX_API_ORIGIN` missing or not a valid `https://coderax-<ip>.sslip.io` origin, or `CODERAX_PROXY_SECRET` missing or shorter than 32 characters. The route returns one message for both, so the 503 alone cannot say which. No Cloudflare credential was available to read the bindings, so this remains **undetermined**, not "both missing". |
| Oracle origin         | Still not recorded in the repository or its history. `DeploymentPlatformAI/DeploymentPlatform` returns `Not Found`, so it is private or moved and cannot be inspected without access. No probe was sent to a guessed address.                                                                                                                                                                   |

### Effective `keep_vars` behavior

Wrangler deletes plain-text dashboard variables that are not declared in the configuration file; it
never deletes secrets. `main` still uses the default (`false`), so `CODERAX_API_ORIGIN` set as a text
variable today is removed by the next Workers Builds deploy. PR #309 (`46ba346f`) adds the top-level
setting, and its `--config-only` gate and tests pass, but it has not merged. Until it does, the origin
must be stored as a **secret** so it survives deploys; the Worker reads a secret binding from `env`
identically. `CODERAX_PROXY_SECRET` is already a secret and is unaffected either way.

### Exact remaining owner actions

1. Repair Cloudflare access without a Global API Key. Either use a scoped API token with
   `Authorization: Bearer` (Wrangler reads `CLOUDFLARE_API_TOKEN`; verify it with
   `curl -sS https://api.cloudflare.com/client/v4/user/tokens/verify -H "Authorization: Bearer
$CLOUDFLARE_API_TOKEN"`), or set the two bindings in the dashboard. Do not create a Global API Key
   to accommodate the connector's header bug: it grants account-wide authority this task does not
   need. With access, confirm the `coderax` build trigger, its last build for `a5d237b0`, and the
   failure reason if a newer build did not run.
2. Store `CODERAX_API_ORIGIN` as a **secret** on the `coderax` Worker (not a text variable) with the
   value from the VM's `origin.env` (`CODERAX_API_HOST`), and store `CODERAX_PROXY_SECRET` as a
   secret with the matching value. Do not paste either value into an issue, PR or chat.
3. On the VM, keep both front-door hosts in `CODERAX_ALLOWED_HOSTS`, set
   `CODERAX_PUBLIC_ORIGIN=https://coderax.nnabdelshahid.workers.dev`, set `BUILD_COMMIT` to the
   deployed source commit and `BUILD_BRANCH=main`, then recreate `app` and `web` without `-v`.
4. Verify the Oracle origin directly with `X-Coderax-Proxy-Secret`, confirm
   `GET /api/work/engines` reports OpenCode `available: true` after the containers are recreated (a
   listening port is not readiness), then run
   `node scripts/verify-coderax-deployment.mjs --live-url https://coderax.nnabdelshahid.workers.dev`
   with the current `main` commit and `node scripts/verify-coderax-access.mjs`.
5. Sign in at `/login?manual=1`, send one Work message, refresh to confirm persistence, then check
   projects, memory, schedules and artifacts before authorizing retirement of Vercel.
6. Review and merge PR #309 so a text `CODERAX_API_ORIGIN` survives future deploys; keep the origin
   as a secret until a build containing it is serving.
7. Merge PR #315 **before** #309 or this branch. `main` does not typecheck:
   `client/src/routes/ChatRoute.tsx` calls `com_work_owner_signin_required`, which
   `client/src/locales/en/translation.json` never carried. #315 adds that key. Any pull request that
   touches the root `package.json` — #309 does — inherits the failure, so the merge order decides
   whether the next required check can pass.

### Cutover and rollback triggers

Accept the cutover only when `/readyz` is `OK` through the Worker, `/api/config` is JSON, no proxied
route returns a Caddy `403`, sign-in succeeds, and one streamed Work reply persists. On any failure,
restore `CODERAX_PUBLIC_ORIGIN=https://coderaxai.vercel.app` and
`CODERAX_PUBLIC_HOST=coderaxai.vercel.app`, recreate the containers, and keep the Vercel project and
its variables. No database, volume or stored record is removed in either direction, and the Vercel
deployment is not deleted without explicit owner authorization.

## Rollback

1. Confirm the retained Vercel deployment can reach the current OCI backend. If its proxy
   variables changed, redeploy and check it as described in the [OCI runbook](../deploy/oci/README.md#legacy-vercel-environment).
2. Restore the legacy public origin in the Compose interpolation environment used to start the app:
   set `CODERAX_PUBLIC_ORIGIN=https://coderaxai.vercel.app` so both `DOMAIN_CLIENT` and
   `DOMAIN_SERVER` use it. In `deploy/oci/origin.env`, set `CODERAX_PUBLIC_HOST=coderaxai.vercel.app`
   for the direct Work stream path. Apply both changes using the same Compose invocation as for
   the cutover: `docker compose -f deploy/oci/compose.yaml up -d app web`. Keep owner-only
   access settings, secrets, volumes and the existing database in place.
3. Verify `/readyz`, confirm `/api/config` reports the legacy `serverDomain`, and sign in at
   `https://coderaxai.vercel.app/login?manual=1`. If a redirect-based sign-in is enabled, restore
   its legacy callback registration and verify the full sign-in flow returns to Vercel. Check a
   direct Work stream before relying on the fallback.
4. Remove `CODERAX_API_ORIGIN` and `CODERAX_PROXY_SECRET` from the Worker to make API forwarding
   fail closed with `503`. If restoring an earlier Worker version, confirm it also leaves forwarding
   disabled. Never remove or prune OCI volumes during rollback.
