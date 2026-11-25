# Coderax: full-stack self-hosted release

This deployment path builds the **same Coderax Dockerfile** as the source repository and runs its real Express API and Vite frontend in one container. MongoDB runs as a separate, authenticated container on an internal-only Docker network. **No Vercel builds are used.**

## Prerequisites

A continuously running Linux machine with Docker Compose v2, sufficient memory/disk for the Node build and persistent MongoDB data, Git credentials for this private repository, and a reverse proxy/tunnel for public HTTPS. Use a dedicated deployment host with durable volumes and backups. DeploymentPlatform's Vercel dashboard alone is not a persistent Docker host.

1. Clone this repository on the authorized Linux host.
2. Copy the repository's `.env.example` to `.env` and configure `JWT_SECRET`, `JWT_REFRESH_SECRET`, `CREDS_KEY`, `CREDS_IV`, `DOMAIN_CLIENT`, `DOMAIN_SERVER` and one working AI inference provider. Do **not** commit `.env` or paste its values into a PR.
3. Add `CODERAX_DB_USER` and `CODERAX_DB_PASSWORD` to `.env`. The password must be URL-safe (generate a long random hex value); Compose interpolates it into the MongoDB URI. Never reuse a MongoDB root password across projects.
4. Set `ALLOW_REGISTRATION=false` for a private instance. For passwordless guest mode, the PR #22 implementation requires `ENABLE_GUEST_ACCESS=true`, but **do not enable public guest mode** without per-user rate limits, spend limits and permitted tool scopes. A private HTTPS VPN-only deployment can use guest mode with reduced exposure.
5. Ensure the model provider is reachable **from inside the Linux app container**; a Windows loopback Ollama model will not be reachable at `127.0.0.1` in the container.

## Deploy

Run from the repository root:

```sh
docker compose --env-file .env -f deploy/selfhost/compose.yaml config --quiet
docker compose --env-file .env -f deploy/selfhost/compose.yaml up -d --build --wait
node scripts/check-selfhost.mjs http://127.0.0.1:3080
```

`--wait` must observe Docker health. The health endpoint is **/readyz**, not /health: /health is merely HTTP liveness and can report OK before MCP and schedule startup finishes. The smoke probe also checks `/api/config` returns JSON rather than the SPA HTML shell.

`node scripts/verify-coderax-deployment.mjs --repo-only` verifies repository contracts and contacts no deployment; it is not deployment verification. `--live-url <origin>` and `--authenticated-e2e` apply only to a supported Coderax Vercel deployment origin: `coderaxai.vercel.app`, or a preview origin listed exactly in `CODERAX_AUTHENTICATED_ORIGINS`. `--live-url <origin>` verifies the live Express API, the SPA and the full commit reported by `/api/config`'s `buildInfo.commit`; a deployment that does not report a full 40-character commit fails, because the deployed revision cannot be identified. Add `--expected-backend-revision <full-commit>` to require a specific commit. Authenticated E2E verification is separate: `--live-url <origin> --authenticated-e2e` runs the deployed smoke and fails closed unless the origin is explicitly allowlisted and `CODERAX_SMOKE_TOKEN` or both `CODERAX_SMOKE_EMAIL` and `CODERAX_SMOKE_PASSWORD` are set; the browser suite is `npm run e2e:deployed` with `E2E_BASE_URL` and `E2E_STORAGE_STATE`. Build metadata can come from environment variables or Git and is not proof of the frontend revision or an immutable image digest.

For a self-hosted Docker deployment, use `node scripts/check-selfhost.mjs <origin>` instead. It accepts only plain-HTTP loopback origins (`localhost`, `127.0.0.1` or `[::1]`), checks `/readyz`, a JSON `/api/config` with a string `appTitle`, and an HTML `/login` page. It does not verify the deployed commit, does not authenticate, and does not support a public HTTPS origin.

Release a compatible frontend/backend pair, deploying the backend first only after establishing backward compatibility. Check the post-release backend-reported build info and deployment metadata independently, then verify required routes and an authenticated Chat/Work lifecycle, including resume and cancellation. The unauthenticated smoke check does not verify those routes, model eligibility or real inference.

Public traffic must terminate TLS at a reverse proxy forwarding to `127.0.0.1:3080`. Configure `DOMAIN_CLIENT` and `DOMAIN_SERVER` to the exact external HTTPS origin, and ensure the reverse proxy forwards streaming responses without buffering and forwards `Host` and `X-Forwarded-Proto`. Keep the MongoDB port unexposed. Retain old Vercel aliases until the new HTTPS domain passes health, session, real model discovery, chat, cancellation, MCP and delegation checks.

## Operator safety

- The `coderax-selfhost` Compose project is isolated from other deployment stacks.
- **Do not** run `docker compose down -v` or `docker volume prune`: MongoDB and user content live in named volumes.
- MongoDB credentials initialized on first boot are persistent; changing values in `.env` does **not** rotate them in an existing MongoDB volume.
- Use `docker compose ... logs --tail=100 app` for boot errors; redact all credentials.
- Always take a verified database backup before altering production, replacing the Docker image, or moving domains.
- This stack does not yet implement a release ledger, staged cutover or automated rollback; those must be added to DeploymentPlatform before calling its rollout process complete.

## DeploymentPlatform integration

The separate DeploymentPlatform Coderax workload profile uses the repository Dockerfile, port 3080, `/readyz` and persistent directories but currently requires a **separately reachable MongoDB connection string** in its encrypted deployment secrets. Do not point that profile at the internal `mongodb` service above unless the Coderax container is explicitly attached to the same private Docker network. The Compose option here is self-contained and does not require DeploymentPlatform to be online.

## Tests

```sh
node --test scripts/check-selfhost.test.mjs
node scripts/check-selfhost.mjs http://127.0.0.1:3080
```

These checks verify API routing/readiness, **not** a real model chat completion. Full inference acceptance needs a configured provider and a permission-scoped test account or guest session.
