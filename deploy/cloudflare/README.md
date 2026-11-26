# Coderax on Cloudflare Workers

The Vite interface and the edge API router run in the `coderax` Cloudflare Worker, connected to
`Auctivon-CoderaxAI/Coderax` through Workers Builds. Every push to `main` builds and deploys the
Worker; no GitHub secret, deploy token or Vercel workload is involved.

**Status on 2026-11-25: the Worker deploys, but it is not yet the application front door.** The SPA
is live at <https://coderax.nnabdelshahid.workers.dev>, while every API, OAuth and health route
returns `503 {"error":"API proxy is not configured"}` because `CODERAX_API_ORIGIN` and
`CODERAX_PROXY_SECRET` are not set on the Worker. `https://coderaxai.vercel.app` therefore remains
the only origin whose API works. Do not announce the Cloudflare origin as production until the
configuration in [Required Worker configuration](#required-worker-configuration) is complete and the
release gate passes.

## Connected deployment

| Setting              | Value                                                               |
| -------------------- | ------------------------------------------------------------------- |
| GitHub repository    | `Auctivon-CoderaxAI/Coderax` (private, default branch `main`)       |
| Cloudflare account   | `19f79492be7da82f6a48c2aea198ef92`                                  |
| Worker               | `coderax`                                                           |
| Production branch    | `main` only                                                         |
| Production origin    | `https://coderax.nnabdelshahid.workers.dev`                         |
| Deployment mechanism | Workers Builds (Cloudflare GitHub App), not a GitHub Actions deploy |

### Build and deploy settings (Workers Builds → Settings → Build)

| Field           | Value                                                                                                                                                                                                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root directory  | repository root (`/`)                                                                                                                                                                                                                                                       |
| Install command | `npm ci`                                                                                                                                                                                                                                                                    |
| Build command   | `npm run frontend` (must leave the built SPA in `client/dist`)                                                                                                                                                                                                              |
| Deploy command  | `npm run deploy:cloudflare` (checks the Worker configuration and revision marker before running `npx --yes wrangler@4.168.0 deploy`)                                                                                                                                        |
| Branch          | `main`                                                                                                                                                                                                                                                                      |
| Preview builds  | Enabled in Workers Builds at **Settings → Build → Branch control → Enable Preview Builds**; each preview is public and is not production. The empty `"previews": {}` in `wrangler.jsonc` only disables named Wrangler preview aliases and does not turn preview builds off. |

`npm run frontend` builds the workspace packages and writes `client/dist`. The client's `postbuild`
hook writes `client/dist/deployment.json` with the commit and branch supplied by Workers Builds. A
clean tracked tree records the full commit; a dirty tracked tree still builds for local development
and e2e, but writes `commit: null` so the artifact is explicitly unverifiable. The
`deploy:cloudflare` command first checks the Worker configuration, including `keep_vars`. It then
verifies that marker against the current checkout and refuses a missing,
null or stale marker, so a manual deploy cannot claim a revision its assets were not built from. The
gate also requires a clean tracked working tree and a full 40-character commit equal to `git rev-parse
HEAD`; untracked build output is ignored. If Workers Builds, GitHub and Vercel expose conflicting
commit values, the script fails instead of choosing one. The deploy command pins Wrangler 4.168.0;
change the pin in `package.json` and this table together.

### Committed configuration

[`wrangler.jsonc`](../../wrangler.jsonc) is committed and reproducible: it names the Worker, the
Worker entrypoint, the asset directory, SPA fallback, and the paths that run the Worker before the
asset runtime (`/api`, `/oauth`, `/health`, `/livez`, `/readyz`). `workers_dev` is explicitly enabled
so the production host cannot disappear from an account default.

## Operator API authentication

Setting these variables requires an authenticated Cloudflare session. The v4 API accepts exactly one
credential scheme per request, and the headers are not interchangeable:

| Credential              | Headers                          | Current value format                             |
| ----------------------- | -------------------------------- | ------------------------------------------------ |
| Global API Key (legacy) | `X-Auth-Email` plus `X-Auth-Key` | `cfk_` followed by the account key               |
| User API token          | `Authorization: Bearer <token>`  | `cfut_` followed by 40 characters and a checksum |
| Account API token       | `Authorization: Bearer <token>`  | `cfat_` followed by 40 characters and a checksum |

`Invalid format for X-Auth-Key header` is Cloudflare rejecting the header before it checks the
credential. It means the value in `X-Auth-Key` is not a Global API Key — in practice a scoped API
token sent with the legacy key headers. A token must be sent as `Authorization: Bearer`; never put a
token in `X-Auth-Key`, and never pair `X-Auth-Email` with a token. Check the format without printing
the secret:

```sh
case "${CLOUDFLARE_API_TOKEN:-}" in
  cfut_*|cfat_*) echo 'scoped API token: use Authorization: Bearer' ;;
  cfk_*) echo 'Global API Key: use X-Auth-Email plus X-Auth-Key' ;;
  '') echo 'no token in this shell' ;;
  *) echo 'unprefixed credential: verify it before use' ;;
esac
```

A token can be verified with
`curl -sS https://api.cloudflare.com/client/v4/user/tokens/verify -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"`,
which returns only the token's status and permissions. Do not create a second credential, rotate a
key, or widen permissions to work around the format error. Wrangler reads `CLOUDFLARE_API_TOKEN` and
sends it as a Bearer token, which is the supported non-interactive path. A connector that sends a
scoped token as `X-Auth-Key` can fail account-scoped calls with `6103` (account and user endpoints)
or `9106` (Workers endpoints) even though the token is valid; fix its header scheme instead of
granting broader permissions.

## Required Worker configuration

These are Worker settings, not repository values. Set them in **Cloudflare → Workers & Pages →
coderax → Settings** (or with `wrangler secret put`); never commit the secret.

| Name                   | Kind          | Value                                                                                                                      |
| ---------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `CODERAX_API_ORIGIN`   | text variable | The authorized OCI API origin, `https://coderax-<public-ip>.sslip.io`, with no path or port.                               |
| `CODERAX_PROXY_SECRET` | secret        | The matching value from the OCI host's `origin.env`; at least 32 characters. Caddy rejects every proxied route without it. |

Wrangler's default is `keep_vars = false`: a deploy deletes plain-text dashboard variables that are
not declared in the configuration file, while secrets are never deleted. [PR
#309](https://github.com/Auctivon-CoderaxAI/Coderax/pull/309) adds top-level `"keep_vars": true` to
[`wrangler.jsonc`](../../wrangler.jsonc) and makes `--config-only` fail if it is removed, but that PR
is **open**, not merged: `main` and the deployed Worker were both `a5d237b0` on 2026-11-26, and the
setting is absent from `main`.

Until #309 merges and a Worker built from the merge is serving, do not store `CODERAX_API_ORIGIN` as
a dashboard text variable — the next deploy deletes it and every API route returns
`503 {"error":"API proxy is not configured"}` again. Store the origin with `wrangler secret put
CODERAX_API_ORIGIN` (or the dashboard's **Secret** type) instead; the Worker reads it from `env`
exactly like a variable, and a deploy never deletes it. After #309 is serving, a text variable is
safe again. `CODERAX_PROXY_SECRET` is a secret and survives either way.

`keep_vars` is enabled in [`wrangler.jsonc`](../../wrangler.jsonc). A Wrangler deploy deletes
plain-text variables that are not declared in the configuration file, so without it the dashboard-set
`CODERAX_API_ORIGIN` would disappear on the next Workers Builds run and every API route would answer
`503 {"error":"API proxy is not configured"}` again. Secrets such as `CODERAX_PROXY_SECRET` are
never deleted by a deploy. `scripts/verify-cloudflare-deployment.mjs --config-only` fails if this
setting is removed.

The OCI application must also accept the Cloudflare hostname. Put these values in
`deploy/oci/app.env` on the VM, then recreate the app. `deploy/oci/compose.yaml` reads `app.env` and
does not override `DOMAIN_CLIENT` or `DOMAIN_SERVER`.

```dotenv
CODERAX_ALLOWED_HOSTS=coderaxai.vercel.app,coderax.nnabdelshahid.workers.dev
DOMAIN_CLIENT=https://coderax.nnabdelshahid.workers.dev
DOMAIN_SERVER=https://coderax.nnabdelshahid.workers.dev
```

For an existing deployment, follow the [OCI domain preflight](../oci/README.md#front-door-environment-cloudflare-first-vercel-legacy)
before recreating the app. Add missing entries and update existing entries in place. Keep the
Vercel hostname in `CODERAX_ALLOWED_HOSTS` during the transition so both front doors can
reach the same backend. After a custom domain is attached, add that hostname too. Passkeys enrolled
on `coderaxai.vercel.app` are bound to that RP ID and will not work on the Cloudflare origin; users
who use passkeys must sign in there with email/password and re-register them. Passkey sign-in on the
Vercel fallback can also fail after `DOMAIN_CLIENT` changes, because the RP ID no longer matches.
`emailLoginEnabled` is true in the current configuration; keep it enabled until re-enrollment is
complete.

## What a merge does

```text
push to main
  └─ Workers Builds: npm ci
       └─ npm run frontend                 -> client/dist (client postbuild writes deployment.json)
            └─ npm run deploy:cloudflare   -> check Worker config, verify deployment.json, deploy
                 └─ Cloudflare serves the new version
                      └─ Cloudflare production verification (GitHub Actions)
                           └─ polls /deployment.json for the merged commit
                           └─ checks SPA, /login, /readyz, /api/config
```

A failed install, build or deploy does not replace the serving version; Cloudflare keeps the last
successful deployment. The verification workflow then keeps polling the old `deployment.json` and
fails, so a failed release is never recorded as a pass.

## Verification

Repository contract, without contacting a deployment:

```sh
node scripts/verify-cloudflare-deployment.mjs --config-only
```

Live deployment, exact revision:

```sh
node scripts/verify-cloudflare-deployment.mjs \
  --url https://coderax.nnabdelshahid.workers.dev \
  --expected-commit "$(git rev-parse origin/main)"
```

The live check fails, rather than skipping, when any of these is missing or wrong: a JSON
`/deployment.json` with a full commit, an HTML application shell, `/login`, `/readyz` equal to `OK`,
JSON `/api/config`, and a matching full `buildInfo.commit` reported by the backend. A deployment
that cannot identify its commit is unverified.

The GitHub workflow
[`cloudflare-production.yml`](../../.github/workflows/cloudflare-production.yml) runs the same checks
after every `main` push. It has no deploy secret and does not deploy; Workers Builds remains the only
deployer. Override the origin with the `CODERAX_PRODUCTION_URL` repository variable after a custom
domain cutover.

## Rollback

Use a previous Worker version; never rebuild a rollback from an unreviewed working copy.

1. In **Cloudflare → Workers & Pages → coderax → Deployments**, find the last version that passed the
   release gate and choose **Rollback**. Or, with an authenticated Wrangler session:

   ```sh
   npx --yes wrangler@4.168.0 deployments list --name coderax
   npx --yes wrangler@4.168.0 rollback <version-id> --name coderax
   ```

2. Confirm the rollback with the same public evidence the gate uses:

   ```sh
   curl -fsS https://coderax.nnabdelshahid.workers.dev/deployment.json
   node scripts/verify-cloudflare-deployment.mjs \
     --url https://coderax.nnabdelshahid.workers.dev \
     --expected-commit <restored-commit>
   ```

   A Worker-only rollback is partial: the gate compares the backend `buildInfo.commit` with the
   restored Worker commit. If the OCI backend still serves a newer commit, the gate fails even
   though the Worker rollback succeeded. Restore the matching OCI image/commit, or record the
   mismatch as an incident; do not treat that gate failure as a failed Worker rollback.

3. Open a reviewed revert pull request so `main` and the deployed version converge again. Keep
   `keep_vars: true` and the predeploy check in the revert so the next Workers Builds deploy
   preserves the dashboard variables. A rollback is an incident response, not the permanent fix.

**Tested where safe:** the committed configuration, the Worker unit suite and the release gate are
covered by `node --test worker/index.test.mjs scripts/verify-cloudflare-deployment.test.mjs` and
`node scripts/verify-cloudflare-deployment.mjs --config-only`. A live rollback was **not** executed:
this workspace has no Cloudflare credentials. The version list and rollback command must be exercised
once by an authenticated operator before relying on them.

## Cost and access boundaries

- Workers Builds and the Worker/assets runtime stay on the account's free allowance. No paid add-on,
  paid plan, custom domain purchase, database, queue or Durable Object is introduced by this setup.
- The Worker holds no application data and no user credentials. It forwards only allowlisted API,
  OAuth and health paths to `CODERAX_API_ORIGIN` and strips hop-by-hop and client-supplied forwarding
  headers.
- The OCI backend and its Atlas database remain the data authority; the Worker is stateless.
- The Cloudflare origin is public; owner-only access is enforced by the backend
  (`registrationEnabled: false`, no social login). Do not add an edge route that bypasses the API.

## Remaining Vercel dependency and safe retirement

Vercel is still a live dependency, and **must not be deleted without explicit owner approval**:

- `https://coderaxai.vercel.app` is the only origin whose API currently works; its Vercel project
  proxy has `CODERAX_API_ORIGIN`, `CODERAX_PROXY_SECRET` and `CODERAX_ALLOWED_HOSTS` configured.
- The GitHub repository homepage and the OCI `DOMAIN_CLIENT` / `DOMAIN_SERVER` values still point at
  that origin, so JWT/cookie behavior and existing sessions are tied to it.
- The repository keeps `vercel.json` and `deploy/vercel/` so the existing deployment can be rolled
  back. Automatic Vercel deployment has been removed: no new Vercel workload is created on merge.

Exact safe retirement procedure:

1. Set the Worker's `CODERAX_API_ORIGIN` and `CODERAX_PROXY_SECRET`. In `deploy/oci/app.env`, keep
   both hosts in `CODERAX_ALLOWED_HOSTS` and set `DOMAIN_CLIENT` / `DOMAIN_SERVER` to the Cloudflare
   origin; recreate the OCI app.
2. Run the live release gate against the Cloudflare origin and confirm `/deployment.json`, `/login`,
   `/readyz` and `/api/config` all pass with the current `main` commit. **If step 2 fails, restore
   `DOMAIN_CLIENT` and `DOMAIN_SERVER` in `app.env` to `https://coderaxai.vercel.app`, keep the
   Vercel hostname in `CODERAX_ALLOWED_HOSTS`, recreate the app, and keep Vercel as the front door.
   Do not remove the Vercel deployment.**
3. Sign in through the Cloudflare origin, send one Work request, refresh, and confirm the
   conversation persists. The Cloudflare domain values become authoritative only after this check
   passes. Before retiring Vercel, also verify that requests from distinct clients reach the OCI
   password login limiter with distinct client identities. The release gate does not verify this
   behavior. Passkeys enrolled on the Vercel origin will not work on the Cloudflare origin; sign in
   with email/password there and re-register them. Passkey sign-in on the Vercel fallback can fail
   after `DOMAIN_CLIENT` changes.
4. Move the canonical domain and the GitHub repository homepage to the Cloudflare origin, then keep
   both origins available for a soak period.
5. Only after the owner explicitly approves retirement, unpublish/delete the Vercel project through
   the Vercel dashboard. Deleting the project removes its deployments and environment variables; it
   does not affect OCI data or the Atlas database.
6. After the rollback window closes, remove `vercel.json`, `deploy/vercel/` and the remaining
   Vercel-specific scripts in a separate reviewed pull request.

Until step 5, `coderaxai.vercel.app` is the fallback front door. Do not remove its environment
variables, its deployment, or its DNS record.
