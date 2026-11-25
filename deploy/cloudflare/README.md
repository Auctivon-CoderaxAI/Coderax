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

| Setting | Value |
| --- | --- |
| GitHub repository | `Auctivon-CoderaxAI/Coderax` (private, default branch `main`) |
| Cloudflare account | `19f79492be7da82f6a48c2aea198ef92` |
| Worker | `coderax` |
| Production branch | `main` only |
| Production origin | `https://coderax.nnabdelshahid.workers.dev` |
| Deployment mechanism | Workers Builds (Cloudflare GitHub App), not a GitHub Actions deploy |

### Build and deploy settings (Workers Builds → Settings → Build)

| Field | Value |
| --- | --- |
| Root directory | repository root (`/`) |
| Install command | `npm ci` |
| Build command | `npm run frontend` (must leave the built SPA in `client/dist`) |
| Deploy command | `npm run deploy:cloudflare` (verifies the revision marker matches the checkout, then `npx --yes wrangler@4.168.0 deploy`) |
| Branch | `main` |
| Preview builds | Enabled in Workers Builds at **Settings → Build → Branch control → Enable Preview Builds**; each preview is public and is not production. The empty `"previews": {}` in `wrangler.jsonc` only disables named Wrangler preview aliases and does not turn preview builds off. |

`npm run frontend` builds the workspace packages and writes `client/dist`. The client's `postbuild`
hook writes `client/dist/deployment.json` with the commit and branch supplied by Workers Builds. The
`deploy:cloudflare` command verifies that marker against the current checkout and refuses a missing
or stale marker, so a manual deploy cannot claim a revision its assets were not built from. The
deploy command pins Wrangler 4.168.0; change the pin in `package.json` and this table together.

### Committed configuration

[`wrangler.jsonc`](../../wrangler.jsonc) is committed and reproducible: it names the Worker, the
Worker entrypoint, the asset directory, SPA fallback, and the paths that run the Worker before the
asset runtime (`/api`, `/oauth`, `/health`, `/livez`, `/readyz`). `workers_dev` is explicitly enabled
so the production host cannot disappear from an account default.

## Required Worker configuration

These are Worker settings, not repository values. Set them in **Cloudflare → Workers & Pages →
coderax → Settings** (or with `wrangler secret put`); never commit the secret.

| Name | Kind | Value |
| --- | --- | --- |
| `CODERAX_API_ORIGIN` | text variable | The authorized OCI API origin, `https://coderax-<public-ip>.sslip.io`, with no path or port. |
| `CODERAX_PROXY_SECRET` | secret | The matching value from the OCI host's `origin.env`; at least 32 characters. Caddy rejects every proxied route without it. |

The OCI application must also accept the Cloudflare hostname. Put these values in
`deploy/oci/app.env` on the VM, then recreate the app. `deploy/oci/compose.yaml` reads `app.env` and
does not override `DOMAIN_CLIENT` or `DOMAIN_SERVER`.

```dotenv
CODERAX_ALLOWED_HOSTS=coderaxai.vercel.app,coderax.nnabdelshahid.workers.dev
DOMAIN_CLIENT=https://coderax.nnabdelshahid.workers.dev
DOMAIN_SERVER=https://coderax.nnabdelshahid.workers.dev
```

If `deploy/oci/app.env` already exists, append these lines; `prepare-env.sh` refuses to overwrite
it. Keep the Vercel hostname in `CODERAX_ALLOWED_HOSTS` during the transition so both front doors can
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
            └─ npm run deploy:cloudflare   -> verify deployment.json + wrangler@4.168.0 deploy
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

3. Open a reviewed revert pull request so `main` and the deployed version converge again. A rollback
   is an incident response, not the permanent fix.

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
   passes. Passkeys enrolled on the Vercel origin will not work on the Cloudflare origin; sign in
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
