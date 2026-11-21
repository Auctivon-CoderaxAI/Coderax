# Local development environment

`npm run dev:up` starts the whole local stack, waits for every service to be ready,
records each PID and writes each log. `npm run dev:down` stops the same processes.
`dev:up` is supported on Linux with readable `/proc` process and boot information.
It exits before starting services when that information is unavailable (including
on macOS and native Windows). `dev:down` only signals processes whose identity it
can verify.

## Commands

| Command                   | What it does                                                                                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev:up`          | Builds missing workspace packages, then starts Mongo, the model, the API and the client; polls readiness for each and records its PID.                                       |
| `npm run dev:down`        | Stops the client, the API, the model and Mongo in reverse order (SIGTERM, then SIGKILL after 10s). Mongo data and the model stay on disk.                                    |
| `npm run dev:status`      | Prints service, PID, port, state and log location. Exits non-zero unless every service is ready.                                                                             |
| `npm run dev:probe`       | Signs in, opens the guest session the browser uses, reads `/api/models`, sends one chat completion, hard-loads the conversation it created, and names the layer that failed. |
| `npm run dev:model`       | Runs the local llama.cpp server in the foreground (the same start script `dev:up` uses).                                                                                     |
| `npm run dev:model:setup` | Downloads the GGUF and builds `llama-server` at the paths `.env` configures, when they are missing.                                                                          |

`dev:probe` accepts `--base` to check a different origin, for example the Vite proxy:

```bash
npm run dev:probe -- --base http://127.0.0.1:3090
```

## What runs

| Service          | Default           | Start command                                                 | Ready when                       |
| ---------------- | ----------------- | ------------------------------------------------------------- | -------------------------------- |
| Mongo            | `127.0.0.1:27017` | `scripts/dev/mongo.mjs` (`mongodb-memory-server`, WiredTiger) | TCP connect succeeds             |
| Model            | `127.0.0.1:8080`  | `scripts/dev/model.sh` (`llama-server`)                       | `GET /health` answers            |
| API              | `127.0.0.1:3080`  | `api/server/index.js`                                         | `GET /readyz` answers 200        |
| Client           | `127.0.0.1:3090`  | `cd client && npm run dev`                                    | `GET /` answers                  |
| Client (preview) | `127.0.0.1:3090`  | `npm run build:client`, then `npm run preview-prod`           | `GET /` and `/api/config` answer |

The client proxies `/api` and `/oauth` to the API, so the app is served at
`http://localhost:3090` while `SERVE_CLIENT=false` keeps the API from needing
`client/dist`. Without that flag the API would either crash on a missing build or
serve a placeholder shell that makes a missing build look healthy.

The client binds loopback by default because its proxy forwards to the API. Set
`DEV_VITE_HOST=0.0.0.0` to reach it from another machine or through a preview proxy;
the proxy target stays the API host (`DEV_API_HOST`, loopback by default).

## Built-client preview

A preview proxy can reject the burst of module requests a Vite dev server makes,
leaving the page blank even though the API is healthy. Set this in `.env` and run
`dev:up` again:

```
DEV_CLIENT_MODE=preview
```

`dev:up` then builds `client/dist` (every run; skip with `DEV_SKIP_CLIENT_BUILD=1`)
and serves it with `vite preview` on the same port, proxying `/api` and `/oauth`
to the API. The service is still called `vite`, so `dev:status` and `dev:down`
manage it like any other; the status detail says `built client`. Switching
`DEV_CLIENT_MODE` while a service runs restarts it, because its recorded command
changed.

## First run

`dev:up` writes two gitignored files if they do not exist:

- `.env` - dev ports, generated JWT/credential secrets, `SERVE_CLIENT=false`,
  `DEV_CLIENT_MODE=dev`, and `DEV_USER_EMAIL` / `DEV_USER_USERNAME` /
  `DEV_USER_PASSWORD` (the password is generated per install and stays here).
- `coderax.yaml` - one `endpoints.custom` entry named `llamacpp` pointing at the
  local model (`http://127.0.0.1:8080/v1`).

It enables passwordless guest access (`ENABLE_GUEST_ACCESS=true`), because the
client's entry screen at `/connect` has no other way in by default, and it
creates the dev user (email verified) once Mongo is up, so `dev:probe` can sign
in. Change ports in `.env` and run `dev:up` again; the supervisor reads them
from there. For a cloud preview, set `VITE_ALLOWED_HOSTS` to the preview hostname
and `DEV_VITE_HOST=0.0.0.0` so the proxy can reach the dev server. `DEV_MONGO_PORT`
and the port in `MONGO_URI` must match when both are set. When only
`DEV_MONGO_PORT` is set, the supervisor uses it to construct the local URI.
`MONGO_URI` must point to loopback for the managed stack.

If an existing local dev account still uses the old shared password, keep the
stack on loopback while you rotate it. With the intended local `MONGO_URI` in
`.env`, run `npm run reset-password`, then set `DEV_USER_PASSWORD` to the new
value in `.env` for `dev:probe`. Restarting the stack does not change existing
accounts. Use network binding only on a trusted network; guest access and
registration are enabled in the generated configuration.

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
.dev/run/<service>.json     recorded PID, port, command, boot ID and process start time
.dev/logs/<service>.log     stdout/stderr of the started process
.dev/mongo/                 Mongo data directory
.dev/model/                 model binary and weights
.dev/cache/                 downloaded mongod binary
```

`dev:down` removes the PID record for each service it stops. If the process has
exited or its identity cannot be verified, only the record is removed. Records
from older versions without a boot ID cannot be verified; stop any still
running services from those versions before starting the updated supervisor. A port that answers without a
record is reported as `untracked` by `dev:status` (with the listening PID when the
system can report it) and is never killed silently.

## Probe layers

`dev:probe` stops at the first failing layer and prints it:

1. `mongo` - TCP connect to `MONGO_URI`.
2. `model` - `llama-server` `/health` and `/v1/models`.
3. `api` - `/health` plus `/readyz`.
4. `auth` - `POST /api/auth/login` with `DEV_USER_EMAIL` / `DEV_USER_PASSWORD`.
5. `guest` - `POST /api/auth/guest`, then `GET /api/user` and `/api/models` with
   that token: the same path the browser takes at `/connect`. Each probe creates
   one guest USER that expires after a week.
6. `models` - `GET /api/models` for the `llamacpp` endpoint.
7. `chat` - one `POST /api/agents/chat` turn, streamed to its final event.
8. `route` - hard-loads `/c/<conversation id>` on the client origin (a full page
   load, not client-side routing), expects the shell, and resolves its entry script
   through the shell's `<base href>` as a browser would; a missing base makes it ask
   for `/c/assets/...` and fail here instead of in the browser.

Environment overrides: `DEV_ENDPOINT` (default `llamacpp`), `LLAMA_BASE_URL`,
`DEV_PROBE_BASE`, `DEV_PROBE_CLIENT` (default the `DEV_VITE_PORT` origin),
`DEV_PROBE_CHAT_TIMEOUT_MS`.
