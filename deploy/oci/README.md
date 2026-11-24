# Coderax API on Oracle Always Free

This deployment keeps the Vite interface on Vercel and runs the database-backed API on an Oracle Always Free A1 VM. Work inference is cloud-only: the application uses the verified $0 OpenRouter models named by `OPENROUTER_API_KEY`, and the VM runs no Ollama service, model weights, or GPU workload. The Vercel API service is a small authenticated streaming proxy. It forwards only `/api`, `/oauth`, and health requests over HTTPS to Caddy on the VM. Caddy accepts the private proxy secret and removes it before forwarding to Coderax. Compose mounts the tracked `deploy/oci/coderax.oci.yaml` at `/app/deploy/oci/coderax.yaml`.

## Free limits and reliability

Use only a `VM.Standard.A1.Flex` instance that the Oracle Console marks **Always Free Eligible**, in the tenancy's home region. Keep the shape at or below 2 OCPUs and 12 GB memory, with a single 50 GB boot volume. The published Always Free allowance covers A1 compute and up to 200 GB of boot and block storage combined. The console's list-price estimate may not subtract tier allowances; do not upgrade the account or choose resources outside the Always Free eligibility and capacity limits. Do not add paid networking, storage, load balancers, support, or trial-only resources. Oracle can reclaim Always Free compute after seven days of low utilization, so the VM is not an uptime guarantee.

## Network boundaries

- Allow inbound TCP 80 and 443 from the Internet for Caddy TLS and Vercel API traffic.
- Allow inbound TCP 22 only from the operator's current public IP while provisioning; remove that temporary rule when SSH setup is complete.
- Do not publish ports 3080, 27017, or 7700.
- Keep the API at one Compose replica while `SCHEDULES_SINGLE_PROCESS=true`; do not scale it horizontally without adding a shared stream store.
- Add only the VM's public IPv4 `/32` to the MongoDB Atlas IP access list. Do not use `0.0.0.0/0`.
- Use a database user with `readWrite` on the `Coderax` database only. Do not reuse an Atlas administrator account.
- The app has no local model server. Its only model path is outbound HTTPS to the verified free OpenRouter endpoint.

## First deployment

1. Create an Ubuntu ARM64 A1 VM in the verified home region with 2 OCPUs, 12 GB memory, and one 50 GB boot volume. Confirm the shape says **Always Free Eligible** and stays within the tenancy's remaining Always Free capacity. Do not select an upgrade or any non-Always-Free resource.
2. Keep the VM's public IPv4 address; add that address as a single `/32` in Atlas after creating a Coderax-only `readWrite` database user.
3. Transfer a reviewed source snapshot of this private repository to the VM over the authenticated operator session. Do not put Git credentials, environment files, SSH private keys, or Atlas credentials in the source archive.
4. Run `sh deploy/oci/prepare-env.sh` on the VM. The script prompts without echo for the database-only MongoDB URI and the existing Production `JWT_SECRET`, `JWT_REFRESH_SECRET`, `CREDS_KEY`, and `CREDS_IV`. Keep those existing values so current sessions and encrypted database credentials remain usable. It also requires an OpenRouter API key, which is the only Work inference path: the verified $0 OpenRouter models are selected automatically. It generates a new proxy secret, writes owner-only local environment files, and does not print their values.
5. Validate the Oracle API hostname printed by the script, then set `CODERAX_API_ORIGIN=https://<printed-host>`, `CODERAX_PROXY_SECRET` from `origin.env`, and `CODERAX_ALLOWED_HOSTS=coderaxai.vercel.app` on the Vercel project's **Production** environment. Keep the secret server-only; never use a `NEXT_PUBLIC_` or `VITE_` variable for it. Set `DOMAIN_CLIENT` and `DOMAIN_SERVER` to `https://coderaxai.vercel.app` on the VM.
6. Configure only inbound 80/443 (and temporary operator-IP-only SSH) in the Oracle security list. Configure Atlas for the VM's `/32` and the Coderax database user above.
7. Run `docker compose -f deploy/oci/compose.yaml config --quiet`, then `docker compose -f deploy/oci/compose.yaml up -d --build --wait`.
8. After the VM reports ready, verify the HTTPS origin directly and then the Vercel canonical URL. The expected checks are `/readyz` = plain `OK`, `/api/config` = JSON, guest access = a 200 response with a guest session, login route = frontend HTML, and a real streamed completion from a verified free OpenRouter model that persists after refresh.

Work's model picker is zero-cost only: it lists the verified OpenRouter `:free` models when `OPENROUTER_API_KEY` is present in `app.env`. If `app.env` already exists, append `OPENROUTER_API_KEY=<key>` (the script refuses to overwrite existing files) and recreate the app container. Never commit or paste that key anywhere else. A missing key leaves Work without a model rather than starting a local one.

The guest endpoint creates isolated expiring user accounts; open registration stays disabled. The app's registration limiter receives the client IP supplied by Vercel. Hosted free inference has no charge, but its per-minute and daily quotas are finite; a guest can exhaust the shared free quota. Disable `ENABLE_GUEST_ACCESS` if abuse appears.

## Vercel environment

Set the following only on the Vercel project that owns the canonical `coderaxai.vercel.app` domain, in **Production**:

- `CODERAX_API_ORIGIN`: the HTTPS `coderax-<public-ip>.sslip.io` address.
- `CODERAX_PROXY_SECRET`: the matching value stored in the VM's `origin.env`.
- `CODERAX_ALLOWED_HOSTS`: `coderaxai.vercel.app`.
- `DOMAIN_CLIENT` and `DOMAIN_SERVER` on the VM: `https://coderaxai.vercel.app`.

Until the proxy origin, secret, allowed host, and source commit are in place, the proxy fails closed with HTTP 503.

## Rollback

Remove the three Vercel proxy environment variables to make the API proxy fail closed, then restore the previous Vercel deployment if needed. Keep OCI volumes and the existing Atlas data. Never run `docker compose down -v` or prune volumes during rollback.
