# Coderax API on Oracle Always Free

This deployment keeps the canonical Vite interface on Cloudflare Workers at `https://coderax.nnabdelshahid.workers.dev` and runs the database-backed API on an Oracle Always Free A1 VM. The legacy Vercel frontend at `coderaxai.vercel.app` stays deployed against the same API until the owner authorizes retirement. Work inference is cloud-only: the application uses the verified $0 OpenRouter models named by `OPENROUTER_API_KEY`, and the VM runs no Ollama service, model weights, or GPU workload. OpenCode runs as a separate authenticated service on the private `engine` network; it has no published port, and only the app container can reach it. The Cloudflare Worker is a small authenticated streaming proxy. It forwards only `/api`, `/oauth`, and health requests over HTTPS to Caddy on the VM. Caddy accepts the private proxy secret and removes it before forwarding to Coderax. Compose mounts the tracked `deploy/oci/coderax.oci.yaml` at `/app/deploy/oci/coderax.yaml`. See [`docs/CLOUDFLARE_MIGRATION.md`](../../docs/CLOUDFLARE_MIGRATION.md) for the cutover and owner handoff.

## Free limits and reliability

Use only a `VM.Standard.A1.Flex` instance that the Oracle Console marks **Always Free Eligible**, in the tenancy's home region. Keep the shape at or below 2 OCPUs and 12 GB memory, with a single 50 GB boot volume. The published Always Free allowance covers A1 compute and up to 200 GB of boot and block storage combined. The console's list-price estimate may not subtract tier allowances; do not upgrade the account or choose resources outside the Always Free eligibility and capacity limits. Do not add paid networking, storage, load balancers, support, or trial-only resources. Oracle can reclaim Always Free compute after seven days of low utilization, so the VM is not an uptime guarantee.

## Network boundaries

- Allow inbound TCP 80 and 443 from the Internet for Caddy TLS and Vercel API traffic.
- Allow inbound TCP 22 only from the operator's current public IP while provisioning; remove that temporary rule when SSH setup is complete.
- Do not publish ports 3080, 4096, 27017, or 7700.
- Keep the OpenCode service on the `engine` network only. Do not add it to the `internet` network or publish 4096; Caddy must not be able to reach it.
- The app and OpenCode share the cloud workspace (`engine-workspace` at `/srv/engine`); the private root is on the app-only `engine-private` volume, which OpenCode does not mount. Both containers run as uid 1000.
- Keep the API at one Compose replica while `SCHEDULES_SINGLE_PROCESS=true`; do not scale it horizontally without adding a shared stream store.
- Add only the VM's public IPv4 `/32` to the MongoDB Atlas IP access list. Do not use `0.0.0.0/0`.
- Use a database user with `readWrite` on the `Coderax` database only. Do not reuse an Atlas administrator account.
- The app has no local model server. Its only model path is outbound HTTPS to the verified free OpenRouter endpoint.

## Engine image verification

`deploy/oci/opencode` is the only image in this stack that CI builds. The `engine-image` job in
[`coderax-oci-proxy.yml`](../../.github/workflows/coderax-oci-proxy.yml) builds it on a hosted runner
and proves what a parsed Compose file cannot: the container becomes healthy, publishes no host port,
rejects anonymous and wrong-password requests with a `401`/`403`, accepts the configured password,
and is healthy again after a restart whose start time actually changed.
Run it without a pull request through **Actions → Coderax API proxy and free-host contracts → Run
workflow** on the branch you want to test. A green Compose parse is not that evidence, and the job
does not prove the deployed VM behavior.

## First deployment

1. Create an Ubuntu ARM64 A1 VM in the verified home region with 2 OCPUs, 12 GB memory, and one 50 GB boot volume. Confirm the shape says **Always Free Eligible** and stays within the tenancy's remaining Always Free capacity. Do not select an upgrade or any non-Always-Free resource.
2. Keep the VM's public IPv4 address; add that address as a single `/32` in Atlas after creating a Coderax-only `readWrite` database user.
3. Transfer a reviewed source snapshot of this private repository to the VM over the authenticated operator session. Do not put Git credentials, environment files, SSH private keys, or Atlas credentials in the source archive.
4. Run `sh deploy/oci/prepare-env.sh` on the VM. The script prompts without echo for the database-only MongoDB URI and the existing Production `JWT_SECRET`, `JWT_REFRESH_SECRET`, `CREDS_KEY`, `CREDS_IV`, and `PASSWORD_LOGIN_PASSWORD`. Keep those existing values so current sessions, encrypted database credentials and the owner sign-in password remain usable. `PASSWORD_LOGIN_PASSWORD` is required: registration, social login and guest access are all disabled, so without it a fresh VM has no way to establish an owner session. The script writes it single-quoted in `app.env` and rejects a value containing a single quote or backslash rather than writing an environment file it cannot parse. It also requires an OpenRouter API key, which is the only Work inference path: the verified $0 OpenRouter models are selected automatically. It generates a new proxy secret, writes `app.env`, `origin.env`, and `engine.env` owner-only, and does not print their values.
5. Validate the Oracle API hostname printed by the script, then set `CODERAX_API_ORIGIN=https://<printed-host>` and `CODERAX_PROXY_SECRET` from `origin.env` as Cloudflare Worker secrets for the `coderax` Worker in **Production**. Keep the secret server-only; never use a `NEXT_PUBLIC_`, `VITE_` or public Worker variable for it. The Worker defaults its API host gate to `coderax.nnabdelshahid.workers.dev`; a nonempty `CODERAX_ALLOWED_HOSTS` replaces that default, so include the canonical host alongside any preview or custom hosts. Set `CODERAX_PUBLIC_ORIGIN=https://coderax.nnabdelshahid.workers.dev` in the Compose environment (the tracked `compose.yaml` already defaults to it), and set `CODERAX_PUBLIC_HOST=coderax.nnabdelshahid.workers.dev` in `origin.env`.
6. Configure only inbound 80/443 (and temporary operator-IP-only SSH) in the Oracle security list. Configure Atlas for the VM's `/32` and the Coderax database user above.
7. Run `docker compose -f deploy/oci/compose.yaml config --quiet`, then `docker compose -f deploy/oci/compose.yaml up -d --build --wait`.
8. After the VM reports ready, verify the Oracle HTTPS origin directly with the proxy secret, then verify the Cloudflare canonical URL without it. Read the secret from `origin.env` into a shell variable; do not echo it, enable `set -x`, or place it in command history. Direct probes without the header return `403`:

   ```sh
   cd deploy/oci
   . ./origin.env
   curl -fsS -H "X-Coderax-Proxy-Secret: $CODERAX_PROXY_SECRET" "https://$CODERAX_API_HOST/readyz"
   curl -fsS -H "X-Coderax-Proxy-Secret: $CODERAX_PROXY_SECRET" "https://$CODERAX_API_HOST/api/config"
   unset CODERAX_PROXY_SECRET
   ```

   Return to the repository root, then run the canonical Worker probes without that header; anonymous checks stay unauthenticated:

   ```sh
   cd ../..
   curl -fsS https://coderax.nnabdelshahid.workers.dev/readyz
   curl -fsS https://coderax.nnabdelshahid.workers.dev/api/config
   node scripts/verify-coderax-access.mjs --base-url https://coderax.nnabdelshahid.workers.dev
   ```

   The expected checks are `/readyz` = plain `OK`, `/api/config` = JSON, anonymous access to `/api/work/chat` and every private collection = `401`/`403`, the owner password form at `/login?manual=1` = frontend HTML, and a real streamed completion from a verified free OpenRouter model that persists after refresh. Full release verification (served revision plus backend revision) is provided by the Cloudflare deployment-acceptance change; `scripts/verify-coderax-deployment.mjs --live-url` additionally needs the exact Workers-origin acceptance from PR #302.

9. Check `GET /api/work/engines` as the owner. OpenCode must report `available: true` only when the authenticated `/global/health` probe succeeds. If it reports `server_unavailable`, inspect `docker compose logs opencode` and the container health status; never treat a listening port or a starting container as readiness.

Work's model picker is zero-cost only: it lists the verified OpenRouter `:free` models when `OPENROUTER_API_KEY` is present in `app.env`. If `app.env` already exists, append `OPENROUTER_API_KEY=<key>` (the script refuses to overwrite existing files) and recreate the app container. Never commit or paste that key anywhere else. A missing key leaves Work without a model rather than starting a local one.

Coderax is owner-only. `ENABLE_GUEST_ACCESS` is `false` and `PASSWORD_LOGIN_PASSWORD` must be set, so the guest endpoint returns 404 and only the owner password form establishes a session. Registration stays disabled. Hosted free inference has no charge, but its per-minute and daily quotas are finite; they belong to the owner, not to anonymous visitors.

## Cloudflare Worker environment (canonical)

Set the following as secrets on the `coderax` Worker in **Production**:

- `CODERAX_API_ORIGIN`: the HTTPS `coderax-<public-ip>.sslip.io` address.
- `CODERAX_PROXY_SECRET`: the matching value stored in the VM's `origin.env`.
- `CODERAX_ALLOWED_HOSTS` (optional public variable): defaults to
  `coderax.nnabdelshahid.workers.dev`; a nonempty value replaces it, so include the canonical host
  plus any preview or custom hosts.
- `CODERAX_PUBLIC_ORIGIN=https://coderax.nnabdelshahid.workers.dev` in the Compose environment;
  `DOMAIN_CLIENT` and `DOMAIN_SERVER` derive from it. If you edit `app.env` directly, the Compose
  `environment:` block still takes precedence.
- `BUILD_COMMIT` on the VM: the full 40-character commit of the deployed source, so `/api/config`
  reports `buildInfo.commit` and the release gate can identify the revision.

Until the proxy origin, secret and source commit are in place, the Worker fails closed with HTTP 503.

## Legacy Vercel environment

The Vercel project keeps its existing `CODERAX_API_ORIGIN`, `CODERAX_PROXY_SECRET` and
`CODERAX_ALLOWED_HOSTS=coderaxai.vercel.app` variables so `coderaxai.vercel.app` continues to serve
while both origins share the API. If this deployment creates a new Oracle origin or a new proxy
secret, update Vercel's Production `CODERAX_API_ORIGIN` and `CODERAX_PROXY_SECRET` to those same
values before relying on the legacy origin for continuity or rollback; the old values will not
authenticate against the new Caddy. Vercel applies environment changes only to new deployments, so
create a new Production deployment and verify `/readyz` and `/api/config` on `coderaxai.vercel.app`
before relying on that origin. Do not remove the variables, project or domain until the owner
authorizes retirement after end-to-end verification.

## Rollback

Follow the [migration rollback steps](../../docs/CLOUDFLARE_MIGRATION.md#rollback) to restore
the legacy OCI public origin and direct Work host, verify Vercel sign-in, then disable Worker
forwarding. Keep OCI volumes, including `engine-workspace`, `engine-private` and
`engine-data`, and the existing Atlas data. Never run `docker compose down -v`
or prune volumes during rollback.
