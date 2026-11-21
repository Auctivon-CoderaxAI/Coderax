# Local development environment

`npm run dev:up` starts the whole local stack, waits for every service to be ready,
records each PID and writes each log. `npm run dev:down` stops the same processes.
No more four terminals or hunting orphaned PIDs.

## Commands

| Command                   | What it does                                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev:up`          | Builds missing workspace packages, then starts Mongo, the model, the API and Vite; polls readiness for each and records its PID.    |
| `npm run dev:down`        | Stops Vite, the API, the model and Mongo in reverse order (SIGTERM, then SIGKILL after 10s). Mongo data and the model stay on disk. |
| `npm run dev:status`      | Prints service, PID, port, state and log location. Exits non-zero unless every service is ready.                                    |
| `npm run dev:probe`       | Signs in, reads `/api/models`, sends one chat completion, and names the layer that failed.                                          |
| `npm run dev:model`       | Runs the local llama.cpp server in the foreground (the same start script `dev:up` uses).                                            |
| `npm run dev:model:setup` | Downloads the GGUF and builds `llama-server` into `.dev/model` when they are missing.                                               |

`dev:probe` accepts `--base` to check a different origin, for example the Vite proxy:

```bash
npm run dev:probe -- --base http://127.0.0.1:3090
```

## What runs

| Service | Default           | Start command                                                 | Ready when                |
| ------- | ----------------- | ------------------------------------------------------------- | ------------------------- |
| Mongo   | `127.0.0.1:27017` | `scripts/dev/mongo.mjs` (`mongodb-memory-server`, WiredTiger) | TCP connect succeeds      |
| Model   | `127.0.0.1:8080`  | `scripts/dev/model.sh` (`llama-server`)                       | `GET /health` answers     |
| API     | `127.0.0.1:3080`  | `api/server/index.js`                                         | `GET /readyz` answers 200 |
| Vite    | `0.0.0.0:3090`    | `cd client && npm run dev`                                    | `GET /` answers           |

Vite proxies `/api` and `/oauth` to the API, so the app is served at
`http://localhost:3090` while `SERVE_CLIENT=false` keeps the API from needing
`client/dist`. Without that flag the API would either crash on a missing build or
serve a placeholder shell that makes a missing build look healthy.

## First run

`dev:up` writes two gitignored files if they do not exist:

- `.env` - dev ports, generated JWT/credential secrets, `SERVE_CLIENT=false`,
  `DEV_USER_EMAIL` / `DEV_USER_PASSWORD` (default `dev@coderax.local` / `coderax-dev`).
- `coderax.yaml` - one `endpoints.custom` entry named `llamacpp` pointing at the
  local model (`http://127.0.0.1:8080/v1`).

It also creates the dev user (email verified) once Mongo is up, so `dev:probe` can
sign in. Change ports in `.env` and run `dev:up` again; the supervisor reads them
from there. For a cloud preview, set `VITE_ALLOWED_HOSTS` to the preview hostname.

## Model artifacts

The model must not live in `/tmp`: an archive or runner restart deletes it. It lives
beside the rest of the local state:

```
.dev/model/bin/llama-server               server plus its shared libraries
.dev/model/qwen2.5-1.5b-q4.gguf           Qwen2.5 1.5B Instruct, Q4_K_M (~1 GB)
.dev/model/llama.cpp/                     optional source checkout for rebuilds
```

`npm run dev:model` starts it with `-c 4096` context, 4 slots, and the alias
`qwen2.5-1.5b-instruct`; `.env` can override `DEV_MODEL_PORT`, `DEV_MODEL_ID`,
`DEV_MODEL_CTX`, `DEV_MODEL_SLOTS` and `DEV_MODEL_THREADS`. If the binary or the
GGUF is missing, `dev:up` stops with the exact path and tells you to run
`npm run dev:model:setup` (needs `cmake` and a C++ toolchain; the GGUF download is
about 1 GB).

## State and logs

```
.dev/run/<service>.json     recorded PID, port, command, start time
.dev/logs/<service>.log     stdout/stderr of the started process
.dev/mongo/                 Mongo data directory
.dev/model/                 model binary and weights
.dev/cache/                 downloaded mongod binary
```

`dev:down` removes the PID record for each service it stops. If a record is stale
the process is gone and only the file is cleaned up. A port that answers without a
record is reported as `untracked` by `dev:status` (with the listening PID when the
system can report it) and is never killed silently.

## Probe layers

`dev:probe` stops at the first failing layer and prints it:

1. `mongo` - TCP connect to `MONGO_URI`.
2. `model` - `llama-server` `/health` and `/v1/models`.
3. `api` - `/health` plus `/readyz`.
4. `auth` - `POST /api/auth/login` with `DEV_USER_EMAIL` / `DEV_USER_PASSWORD`.
5. `models` - `GET /api/models` for the `llamacpp` endpoint.
6. `chat` - one `POST /api/agents/chat` turn, streamed to its final event.

Environment overrides: `DEV_ENDPOINT` (default `llamacpp`), `LLAMA_BASE_URL`,
`DEV_PROBE_BASE`, `DEV_PROBE_CHAT_TIMEOUT_MS`.
