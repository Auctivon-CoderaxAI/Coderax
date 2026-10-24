# Coderax: cloud-only, key-free inference (deployment candidate)

This stack runs **on a remote Linux GPU server**, not on the Windows machine used
for development. Open Coderax from any browser over HTTPS. The Qwen model and
MongoDB remain on the **private Docker network** and have no public ports.
The only AI model is `qwen3.5:4b`; Ollama cloud access is disabled.

**Current status:** Infrastructure-as-code only. This repository does **not**
include a leased server, working DNS, production secrets, or a verified deployment.
Do not call Coderax cloud-ready until the steps below and browser tests pass.

## Prerequisites

- A remote Linux server with working Docker Compose, an NVIDIA GPU, the
  NVIDIA Container Toolkit, a persistent disk, and an approved hosting budget.
- An owned DNS hostname (e.g. `chat.example.com`) pointing to the server's
  public IP. Inbound TCP ports **80 and 443** must reach Caddy; **do not**
  expose ports 11434, 27017, 7700 or 3080.
- `.env` at the repository root, copied from `.env.example` and stored
  **only on the server** (never in Git). Provide `CODERAX_DOMAIN`,
  `MONGO_ROOT_PASSWORD` (URL-safe random hex), `MEILI_MASTER_KEY`,
  `CREDS_KEY`, `CREDS_IV`, `JWT_SECRET`, and `JWT_REFRESH_SECRET`.
  Use separately generated high-entropy values. Keep `ALLOW_REGISTRATION=false`.
  Remove `user_provided` provider keys if not intentionally used.
- Replace the supplied images with reviewed/pinned versions before long-term
  production operation. In particular, pin `ollama/ollama` to a known image
  digest after a supported-version review.

## Deploy to the remote server only

```sh
docker compose --env-file .env -f deploy/cloud/compose.yaml config --quiet
docker compose --env-file .env -f deploy/cloud/compose.yaml up -d --build
docker compose --env-file .env -f deploy/cloud/compose.yaml exec ollama ollama pull qwen3.5:4b
docker compose --env-file .env -f deploy/cloud/compose.yaml exec api node scripts/probe-cloud-model.mjs
docker compose --env-file .env -f deploy/cloud/compose.yaml exec api npm run create-user
```

If the deployment image doesn't include `scripts/probe-cloud-model.mjs`,
rebuild using the updated repository revision. The smoke test explicitly checks
`/v1/models` and generates a real Qwen completion on the remote GPU. It does
not use an OpenAI/Ollama Cloud/API-provider key; the `apiKey` value in
`coderax.yaml` is a nonsecret OpenAI-client compatibility placeholder.
Host secrets protect the **application**, not an AI model provider account.

Caddy handles HTTPS certificates automatically once DNS/ports work. Coderax
must remain the *only* publicly reachable application in this compose stack.
The first account should be created via the CLI before anyone signs in.
Do not turn on public signups until registration abuse controls are tested.

## Verification gate before calling it live

1. Cloud model smoke test prints `CLOUD_MODEL_OK`; model inventory contains
   `qwen3.5:4b`, and Ollama is not reachable from the public internet.
2. From **another device**, open `https://<CODERAX_DOMAIN>`, log in as the
   created user, select Ollama / Qwen 3.5 4B, send a prompt, and verify real
   streamed output. Refresh and verify the conversation persists in MongoDB.
3. Restart the stack and confirm stored chats survive a restart.
4. Verify auth rejection for anonymous API access and verify remote access from
   mobile data, not the host's LAN.
5. Separately check file upload and RAG extraction before advertising those
   features: this initial compose intentionally does **not** provision a RAG
   embedding/vector pipeline or file-search support.
6. The CyVox add-on is **read-only status integration**, not a chat model router.
   After a separately deployed authenticated HTTPS CyVox service is verified,
   set `CYVOX_ADDON_ENABLED=true`, `CYVOX_BASE_URL`, and
   `CYVOX_AUTH_TOKEN` **only** in the server's `.env`. Live CyVox inference
   requires a separate tested model connection; it is not established here.

Do not create billable GPU instances, purchase a domain, merge or deploy
production changes, or claim success merely because a build or HTTP 200 passes.
