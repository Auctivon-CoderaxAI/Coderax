# Local development services

## Whole stack

```bash
CODERAX_PREVIEW_HOST=<preview hostname> npm run dev:up
npm run dev:down
```

`dev:up` starts MongoDB, the API, the local model and Vite in order, waiting until
each answers before moving on; `dev:down` stops them in reverse order. Every
service runs in its own process group with a PID in `.dev/pids/` and a log in
`.dev/logs/`, so stopping the stack cannot leave an npm or nodemon wrapper behind.
Re-running `dev:up` is safe: services already up are reused.

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
  port is already taken, instead of printing a mongod stack trace.

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

`npm run dev:api` sets `VERCEL=1`, selecting the server's supported no-client-shell
branch: only `/api` and `/oauth` are served and no `client/dist` is needed, because
Vite is the UI. A production run (`npm run backend`) still serves the compiled
client from `npm run build:client`.

Endpoints and models come from `coderax.yaml`.

## UI

```bash
cd client && HOST=0.0.0.0 PORT=3000 npm run dev
```

Vite proxies `/api` and `/oauth` to the API on port 3080.
