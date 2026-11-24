# Coderax frontend on Vercel

The Vite interface is served by the Vercel project behind `coderaxai.vercel.app`.
That deployment is produced by [`vercel-production.yml`](../../.github/workflows/vercel-production.yml)
on every push to `main`. Nothing in the repository deployed it before, so merges
never reached production and the alias kept serving an old build.

The repository has two Vercel services, both declared in the root [`vercel.json`](../../vercel.json):

- `frontend` - root `client`, `framework: vite`, output `dist`. Its
  `buildCommand` runs `npm run frontend` (data-provider, data-schemas, api,
  `@coderax/client`, then the SPA) and the release-gate client tests.
- `backend` - root `.`, entrypoint `api/proxy.js`, which forwards `/api`,
  `/oauth` and the health routes to the OCI host.

## Required repository secrets

Set these under **Settings → Secrets and variables → Actions → Repository
secrets**. They belong to the Vercel project that owns the production alias; do
not add them to the VM or to `vercel.json`.

| Secret              | What it is                                        | Where to get it                                                                                                                               |
| ------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `VERCEL_TOKEN`      | Personal/team access token used by the Vercel CLI | <https://vercel.com/account/tokens> → **Create Token**, scoped to the team that owns the project. Give it an expiry you will actually rotate. |
| `VERCEL_ORG_ID`     | Team (or user) id, `team_…` / `user_…`            | `vercel link` in a checkout, then `.vercel/project.json` → `orgId`; or the team's **Settings → General**.                                     |
| `VERCEL_PROJECT_ID` | Project id, `prj_…`                               | Same `.vercel/project.json` → `projectId`; or **Project → Settings → General → Project ID**.                                                  |

`gh secret set VERCEL_TOKEN`, `gh secret set VERCEL_ORG_ID` and
`gh secret set VERCEL_PROJECT_ID` from an authenticated operator avoids pasting
values into a file. `.vercel/` is already gitignored; never commit it.

When any of these is missing, `Vercel production deployment` and `Coderax
post-merge deployment verification` name every absent secret in a notice and
step summary, then skip their deploy and verify steps. An unconfigured
repository therefore shows a successful run with an explicit "skipped"
annotation instead of a red job on every push. Add the secrets and re-run either
workflow; nothing deploys without them.

## Vercel project settings

The workflow deploys with the CLI, so the project must match the repository
contract:

**Settings → General**

- **Root Directory:** empty (repository root). `client/vercel.json` is a
  rewrites-only leftover and is _not_ the project root: at `client` Vercel would
  ignore the root `vercel.json` services block, `/api` would stop resolving, and
  `npm run frontend` (which builds the workspace packages the SPA imports) would
  never run. The release gate also requires the API runtime dependencies at the
  repo root for function tracing.
- **Framework Preset:** leave unset / **Other**. The services declare `vite` and
  `express` themselves; a project-level preset applies to the whole root and
  overrides them.
- **Build & Development Settings:** keep **Override** off for Install Command,
  Build Command and Output Directory. The services supply them.
- **Ignored Build Step:** empty. A path-filtered ignore command silently keeps
  the previous deployment in place, which is the failure this workflow exists to
  prevent.
- **Node.js Version:** `24.x` (`.nvmrc` pins `24.16.0`).

**Settings → Git**

- `main` is the **Production Branch**.
- Either let Vercel deploy on push, **or** run this workflow — not both, or every
  merge builds twice and races for the alias. This workflow is the supported
  path, so turn off the project's automatic production deployments (or leave the
  repository disconnected).

**Settings → Environment Variables (Production)**

| Variable                | Purpose                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `CODERAX_API_ORIGIN`    | HTTPS origin of the OCI Caddy front (`https://<host>.sslip.io`).                     |
| `CODERAX_PROXY_SECRET`  | Shared secret from the VM's `origin.env`; server-only, never `VITE_`/`NEXT_PUBLIC_`. |
| `CODERAX_ALLOWED_HOSTS` | `coderaxai.vercel.app`.                                                              |

Without these the proxy fails closed with HTTP 503. Add them to **Preview** as
well only if preview deployments should reach the same API.

**Settings → Domains**

- `coderaxai.vercel.app` is attached to **Production**, not to a single
  deployment. An active **Instant Rollback** pins an old deployment and must be
  removed before the alias can track `main` again.

## How a deploy runs

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:29aaa461b1d97524d704d1b9eb7a9b0935c4be9f345bc7fb90e66017dbe98f61 -->

1. `scripts/verify-coderax-deployment.mjs --repo-only` — the deployment contract
   (services, rewrites, traced API dependencies) still matches the repo.
2. After installing the CLI, compare the checked-out revision to current `main`.
   Superseded runs skip deployment and verification; a failed lookup stops the run.
3. `vercel deploy --prod --yes` — remote build, so the services' own build
   commands (and the release-gate tests they run) execute on Vercel. The workflow
   does not use `--prebuilt`.
4. Alias check — the entry bundle served by `coderaxai.vercel.app` must match the
   bundle the new deployment built, polled cache-busted for about three minutes.
5. `/readyz` is reported as a warning, because the API is deployed separately on
   the OCI host.

The check observes `main` immediately before deployment. A push after that check
can still make an in-flight deployment temporarily stale; the newer push needs its
own successful run.

<!-- /coderabbit-ai-generated:v1 -->

## Failure modes

- **Missing secret:** the deploy step stops before installing the CLI and names
  the secret it needs.

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:b77f2160eb7fdf234f2d34fa28438eb0f6a0e1accbfe97c999ad91df5ff07af7 -->

- **Unreadable deployment URL:** the alias check **fails closed**. If
  `https://<deployment>` does not return the SPA (Vercel Authentication, a bad
  URL, an outage), the run fails instead of assuming the alias is fine. The
  public production domain does not imply the generated production deployment
  URL is public: [Standard Protection](https://vercel.com/docs/deployment-protection#standard-protection)
  protects deployment URLs while exempting production domains. In **Settings →
  Deployment Protection**, configure protection so that the generated production
  deployment URL is publicly readable by this workflow; for example, disable
  protection for the project where team policy permits. Verify the generated URL
  directly. This may also expose preview deployments.

<!-- /coderabbit-ai-generated:v1 -->

- **Alias still on an older build:** after roughly three minutes of polling, the
  run fails with the bundle the deployment built and the one the alias serves.
  The deployment exists but is not what users get, so the release is not done.
- **API down:** `/readyz` warns only. The frontend release does not wait on the
  OCI host.

## Deploying by hand

The workflow also accepts `workflow_dispatch` from `main` (the job is skipped on
any other ref), which is the recovery path for a merge that landed before the
workflow existed:

```bash
gh workflow run "Vercel production deployment" --ref main
```

Locally, with the CLI linked to the same project:

```bash
vercel deploy --prod
```

A manual `vercel deploy --prod` must run from a checkout that is actually at
`main`; the stale production build came from a working copy that was behind.

## Pinned Vercel CLI

The workflow installs `vercel@66.6.0`, taken from the `VERCEL_CLI_VERSION` env
value in the workflow file, and fails if `vercel --version` does not report that
number.
The pin is deliberate: the CLI uploads a **Vercel Services** project, so a major
bump changes the deploy path instead of being a routine upgrade.

To bump it, change the `VERCEL_CLI_VERSION` env value in the workflow and this
section together, merge to
`main`, then dispatch the workflow and confirm the alias check passes. Before
merging, check that `vercel deploy --help` at the new version still lists
`--prod`, `--yes` and `--archive`.

## Known follow-up

`coderax-post-merge-deployment.yml` expects `/api/config` to report
`buildInfo.commit` equal to the pushed SHA. The API runs on the OCI host, where
`packages/api/src/app/build.ts` can only resolve `BUILD_COMMIT` / `BUILD_BRANCH` /
`BUILD_DATE` from the environment. Set those in `deploy/oci/compose.yaml` from
the deployed snapshot, or scope that revision assertion to the frontend
deployment; otherwise that check stays red after every merge.
