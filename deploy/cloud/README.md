# Coderax: cloud-only, zero-cost hosted inference (deployment candidate)

This stack runs **on a remote Linux host**, not on the Windows machine used for
development. Open Coderax from any browser over HTTPS. MongoDB and Meilisearch
remain on the private Docker network and have no public ports. Work inference is
cloud-only: the verified $0 OpenRouter models are used when
`OPENROUTER_API_KEY` is set in the server `.env`. No GPU, Ollama service, or
local model weights are part of this stack.

**Current status:** Infrastructure-as-code only. This repository does **not**
include a leased server, working DNS, production secrets, or a verified
deployment. Do not call Coderax cloud-ready until the steps below and browser
tests pass. An in-flight Work run executes in the API process; restarting the
API cancels it. Durable job queues are not provisioned here.

## Prerequisites

- A remote Linux server with working Docker Compose and a persistent disk.
  A GPU is not required.
- An owned DNS hostname (e.g. `chat.example.com`) pointing to the server's
  public IP. Inbound TCP ports **80 and 443** must reach Caddy; **do not**
  expose ports 27017, 7700 or 3080.
- `.env` at the repository root, copied from `.env.example` and stored
  **only on the server** (never in Git). Provide `CODERAX_DOMAIN`,
  `MONGO_ROOT_PASSWORD` (URL-safe random hex), `MEILI_MASTER_KEY`,
  `CREDS_KEY`, `CREDS_IV`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, and the required
  `OPENROUTER_API_KEY` for the verified free Work models. Use separately
  generated high-entropy values. Keep `ALLOW_REGISTRATION=false`.

## Deploy to the remote server only

```sh
docker compose --env-file .env -f deploy/cloud/compose.yaml config --quiet
docker compose --env-file .env -f deploy/cloud/compose.yaml up -d --build
docker compose --env-file .env -f deploy/cloud/compose.yaml exec api npm run create-user
```

`deploy/cloud/coderax.yaml` enables the verified free catalog and embeds no
credential. After rotating `OPENROUTER_API_KEY`, recreate the API service with
`docker compose --env-file .env -f deploy/cloud/compose.yaml up -d api`.

Caddy handles HTTPS certificates automatically once DNS/ports work. Coderax
must remain the *only* publicly reachable application in this compose stack.
Create the first account via the CLI before anyone signs in. Do not turn on
public signups until registration abuse controls are tested.

## Verification gate before calling it live

1. From another device, open `https://<CODERAX_DOMAIN>`, log in as the created
   user, select a verified free model, send a prompt, and verify real streamed
   output. Refresh and verify the conversation persists in MongoDB.
2. On the verification stack, confirm the model picker shows only free models.
   Remove `OPENROUTER_API_KEY` from the server `.env` and recreate the API with
   `docker compose --env-file .env -f deploy/cloud/compose.yaml up -d --force-recreate api`.
   Confirm Work is unavailable and does not fall back to a paid or local model.
   Restore the key in `.env`, run the same command again, and confirm a Work
   request streams a successful response before continuing.
3. Restart the stack and confirm stored chats survive a restart.
4. Verify auth rejection for anonymous API access and verify remote access from
   mobile data, not the host's LAN.
5. Separately check file upload and RAG extraction before advertising those
   features: this initial compose intentionally does **not** provision a RAG
   embedding/vector pipeline or file-search support.
6. The CyVox add-on is **read-only status integration**, not a chat model
   router. Live CyVox inference requires a separate tested model connection.

Do not create billable infrastructure, purchase a domain, merge or deploy
production changes, or claim success merely because a build or HTTP 200 passes.
