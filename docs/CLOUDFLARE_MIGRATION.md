# Coderax frontend migration: Vercel → Cloudflare Workers

Canonical origin: **https://coderax.nnabdelshahid.workers.dev**

Legacy origin: **https://coderaxai.vercel.app** — still deployed, and must stay deployed until
the owner authorizes retirement in writing.

This migration moves only the frontend and its edge API route to the Cloudflare Worker at
[`worker/index.mjs`](../worker/index.mjs). The database-backed Express API, MongoDB data, model
routing, agents and schedules stay exactly where they are on the Oracle Always Free host. No
database was created, reset, migrated or reseeded.

## What the Worker does

| Request | Behaviour |
| --- | --- |
| `/api`, `/api/*`, `/oauth/*`, `/health`, `/livez`, `/readyz` | Forwarded to the configured `CODERAX_API_ORIGIN` with the proxy secret, after the host gate. |
| Every other path | Served from `client/dist` with the SPA fallback. |

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

| Concern | Current behaviour |
| --- | --- |
| Cookies | `refreshToken` and `token_provider` are host-only (no `Domain=`), `Secure`, `HttpOnly`, `SameSite=Strict`. Moving origin creates a new session; no cookie is shared or migrated. |
| CORS | The API answers `cors()`; the real gate is `requireSameOrigin`, which trusts `DOMAIN_CLIENT`/`DOMAIN_SERVER` and also the request's own forwarded host. Both origins keep working during the transition. |
| CSP | The API's policy uses `'self'` and `https:`/`wss:` connect sources, so it does not name a hostname. The static SPA shell is served by the Worker exactly as Vercel served it, with no CSP of its own. |
| Service worker | Registered per origin at scope `/`. The new origin gets a fresh precache; the old Vercel service worker cannot control it. |
| API routing | Worker allowlist above; `api/proxy.ts` remains the Vercel path. |
| OAuth callbacks | Social, OpenID and admin SSO are disabled. If one is enabled later, register the new redirect URIs at the provider: `/oauth/<provider>/callback` and `/api/admin/oauth/<provider>/callback` on the new origin, and set `DOMAIN_SERVER` to it. |
| Passkeys | Disabled. If enabled later, pin `PASSKEY_RP_ID` and add the new origin to `PASSKEY_ORIGINS`; changing the RP ID invalidates existing passkeys. |
| Password reset / verification links | Disabled: `ALLOW_PASSWORD_RESET=false` and registration is off, so no such link is issued. If enabled later, they use `DOMAIN_CLIENT`. |
| Deployment verification | `scripts/verify-coderax-deployment.mjs --live-url` currently accepts only the legacy Vercel alias; PR #302 adds the exact Cloudflare origin and its regression suite. Authenticated smoke runs remain restricted to the exact allowlisted origin. |

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
   The first requires a full 40-character `buildInfo.commit`; the second requires owner-only
   configuration and `401`/`403` on every private route.
6. **Verify data in the UI** — recent conversations, projects and files, persistent memory, Work
   history, saved settings, agent configurations, authorized integrations, scheduled tasks and
   generated artifacts. The backend did not move, so any absence is a defect, not a migration
   step that should be "fixed" by resetting anything.
7. **Retirement is separate.** Do not remove the Vercel project, its domain or its proxy variables
   until the owner explicitly authorizes it after step 6.

## Rollback

Remove `CODERAX_API_ORIGIN` and `CODERAX_PROXY_SECRET` from the Worker to make its API route fail
closed with `503`. The legacy Vercel origin keeps serving and forwarding to the same API. Restore
the previous Worker version from the Cloudflare dashboard if the Worker source itself is at fault.
Keep every OCI volume and the existing database in place.
