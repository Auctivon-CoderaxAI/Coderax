# Local development services

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:d282021cb554db03debd10da466f4b70c3d019b1089d9555c3d8931dd33eea2a -->

## Whole stack

On a fresh checkout, install dependencies and build the workspace packages before
starting the stack. The API and Vite use the generated package outputs.

```bash
npm ci
npm run build:packages
```

Configure the [API environment](#api), then start the stack:

```bash
CODERAX_PREVIEW_HOST=<preview hostname> npm run dev:up
npm run dev:down
npm run dev:status
```

`dev:up` starts MongoDB, the API, the local model and Vite in order, waiting until
each answers before moving on; `dev:down` stops them in reverse order. Every
service runs in its own process group with its PID and start time in `.dev/pids/` and a log
in `.dev/logs/`, so shutdown can reach children even if their wrapper exits. Before
signaling, `dev:down` checks that the live PID still has the recorded start time; a record
that cannot be verified is reported and kept without being signaled. If a group cannot be
stopped, its record is kept and `dev:down` exits non-zero.
Running `dev:up` again after startup reuses services already up.

`dev:status` reads the same PID files and reports each service's PID, port and
readiness without starting or stopping anything; it flags stale PID files and
ports held by other processes, and exits non-zero when a service is missing or
unready.

`CODERAX_PREVIEW_HOST` (or `VITE_ALLOWED_HOSTS`) supplies the hostname Vite must
accept; without it the API and UI still start but the preview panel returns 403.
The model is skipped with a warning when its binary or weights are missing.

## MongoDB

```bash
npm run dev:mongo   # 127.0.0.1:27017, database Coderax; Ctrl+C stops it
```

- Data lives in `.dev/mongo/data` (gitignored) and survives restarts.
- The first run downloads a `mongod` binary through `mongodb-memory-server`, so
  `npm ci` must have run first.
- `CODERAX_MONGO_PORT` overrides the port. The script refuses to start when the
  port is already taken, instead of printing a mongod stack trace. If you change
  the port, update `MONGO_URI` in the API environment to match.

<!-- /coderabbit-ai-generated:v1 -->

## Local model

```bash
npm run dev:model                 # install if needed, then serve 127.0.0.1:8080
npm run dev:model -- --install    # install only
```

- Downloads a pinned llama.cpp CPU release (Linux x64) and a pinned revision of
  the Qwen2.5-1.5B Instruct Q4_K_M GGUF (~1 GB) into `.dev/model/`, verifying the
  GGUF against its SHA-256, so the model survives restarts and archives instead
  of living under `/tmp`.
- Ctrl+C stops it; inside the stack `npm run dev:down` does. `dev:up` skips it
  with a warning until `--install` has run, so the rest of the stack still works.
- On other platforms, install llama.cpp yourself and put `llama-server` and its
  libraries in `.dev/model/bin/`; the script only downloads the Linux build.

Point a repository-root `coderax.yaml` (gitignored) at the server:

```yaml
version: 1.3.17
endpoints:
  custom:
    - name: 'llamacpp'
      apiKey: 'local'
      baseURL: 'http://127.0.0.1:8080/v1'
      models:
        default: ['qwen2.5-1.5b-instruct']
        fetch: false
      modelDisplayLabel: 'Local (llama.cpp)'
```

`llamacpp` is one of the app's local endpoints, so Chat treats the model as free
and skips paid-provider consent.

## API

A repository-root `.env` (gitignored) needs at least:

```dotenv
MONGO_URI=mongodb://127.0.0.1:27017/Coderax
DOMAIN_CLIENT=http://localhost:3000
DOMAIN_SERVER=http://localhost:3080
CREDS_KEY=<64 hex chars>
CREDS_IV=<32 hex chars>
JWT_SECRET=<32+ chars>
JWT_REFRESH_SECRET=<32+ chars>
```

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:5f604591f694071bb110f4865a1e2e4fd952c48f2a58f36cdf1bd80e46135369 -->

`npm run dev:api` sets `VERCEL=1`, selecting the server's supported no-client-shell
branch: only `/api` and `/oauth` are served and no `client/dist` is needed, because
Vite is the UI. Both development launch commands default the API to `127.0.0.1`;
set `HOST` explicitly to bind it to another interface. A production run
(`npm run backend`) still serves the compiled client from `npm run build:client`.

<!-- /coderabbit-ai-generated:v1 -->

Endpoints and models come from `coderax.yaml`.

## UI

```bash
cd client && HOST=0.0.0.0 PORT=3000 npm run dev
```

Vite proxies `/api` and `/oauth` to the API on port 3080.
