# Coderax legacy front door on Vercel (frozen)

**Status: legacy, retained for rollback. Do not deploy from this repository, and do not delete the
project without explicit owner approval.**

`https://coderaxai.vercel.app` is still the only origin whose API reaches the OCI backend, because
the Cloudflare Worker has no `CODERAX_API_ORIGIN` or `CODERAX_PROXY_SECRET` yet. The repository's
production path is [`deploy/cloudflare/README.md`](../cloudflare/README.md); the Cloudflare Worker
builds from `main` through Workers Builds.

Automatic Vercel deployment has been removed. `vercel-production.yml` and
`coderax-post-merge-deployment.yml` no longer exist, so a merge to `main` creates no new Vercel
workload. The Vercel project, its production alias, its environment variables, and the existing
deployment remain untouched for rollback.

## What still depends on Vercel

- The production alias `coderaxai.vercel.app` is the working front door and the origin named by the
  GitHub repository homepage.
- The Vercel project's Production environment holds `CODERAX_API_ORIGIN`, `CODERAX_PROXY_SECRET` and
  `CODERAX_ALLOWED_HOSTS`, which forward `/api`, `/oauth` and the health routes to the OCI Caddy front.
- The OCI app's `DOMAIN_CLIENT` / `DOMAIN_SERVER` point at this origin, so browser sessions and
  cookies are bound to it.
- `vercel.json` describes the two Vercel services (`frontend`, `backend`) used by the existing
  deployment. It is kept only so a rollback does not require reconstructing the project.

## Inspect or roll back the existing deployment

Use the Vercel dashboard, or an authenticated operator session:

```sh
vercel ls --prod
vercel inspect <deployment-url>
vercel rollback <deployment-url>
```

A rollback changes the alias only; it creates no new workload from this repository. Verify the
restored alias with the legacy contract check before relying on it:

```sh
node scripts/verify-coderax-deployment.mjs \
  --live-url https://coderaxai.vercel.app
```

That check fails today because `/api/config` has no full `buildInfo.commit`. The failure is accurate:
the legacy backend cannot identify its revision. Do not treat a 200 from the SPA as verification.

## Safe retirement procedure

1. Complete the Cloudflare Worker configuration in
   [`deploy/cloudflare/README.md`](../cloudflare/README.md): origin, proxy secret, OCI allowed host,
   and `DOMAIN_CLIENT` / `DOMAIN_SERVER`.
2. Confirm the Cloudflare release gate passes for the current `main` commit, including `/readyz` and
   a matching `/api/config` `buildInfo.commit`.
3. Sign in through the Cloudflare origin, send one Work request, refresh, and confirm the
   conversation persists. Existing sessions will sign in again because the origin changed.
4. Move the canonical domain and the GitHub repository homepage to the Cloudflare origin. Keep both
   origins available for a soak period.
5. Only after the owner explicitly approves retirement, unpublish/delete the Vercel project. This
   removes its deployments and environment variables; it does not affect OCI data or Atlas.
6. After the rollback window closes, remove `vercel.json`, this directory, and the remaining
   Vercel-specific scripts in a separate reviewed pull request.

Until step 5, keep the Vercel deployment, its alias, its environment variables, and its DNS record.
Deleting any of them without owner approval removes the only working front door.
