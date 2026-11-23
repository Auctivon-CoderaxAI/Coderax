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

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:235f07bf78c167e21f860583aa67565b4f62ad9744235b92e1d10aae58e3bc1d -->

`dev:up` starts MongoDB, the API, the local model and Vite in order, waiting until
each answers before moving on; `dev:down` stops them in reverse order. Each
service runs in its own process group and writes a log to `.dev/logs/`. The
record in `.dev/pids/` has a marker that the service and its children inherit.
<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:38068ead6e96172e13dedd8858f59124addee68c4ab4304e4f305f12ce780b64 -->

The supervisor records each launcher before allowing it to start its service.
Shutdown checks the ownership marker before signaling a group, even if its
original leader has exited. If a record cannot be read or a group cannot be
verified or stopped, `dev:down` leaves that record in place, tries the remaining
services, and exits nonzero.

Running `dev:up` again reuses services that are already healthy. To switch
between loopback and a network preview, or to change the preview hostname,
run `npm run dev:down` first. Do the same if the running UI predates preview
settings in its PID record.

<!-- /coderabbit-ai-generated:v1 -->

Only one `dev:up` or `dev:down` can run at a time. If an interrupted command
leaves `.dev/stack.lock`, confirm that neither command is running before using
`rmdir .dev/stack.lock`. To upgrade a running stack, stop it with your old
checkout first. The new supervisor cannot verify a running group from an old
PID or start time record alone. If you already upgraded, identify and stop any
old stack processes manually before removing their records.

<!-- /coderabbit-ai-generated:v1 -->

`dev:status` reads the same PID files and reports each service's PID, port and
readiness without starting or stopping anything; it flags stale PID files and
ports held by other processes, and exits non-zero when a service is missing or
unready.

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:15139b5d1e4b7c677dbf14065132a9ad8bb15d48f34d96692f07ab8290cf864a -->

Vite binds to loopback by default. Setting `CODERAX_PREVIEW_HOST` (or `VITE_ALLOWED_HOSTS`) enables a network listener and supplies the hostname Vite must accept. Enable it only on a trusted network.

<!-- /coderabbit-ai-generated:v1 -->
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

<!-- coderabbit-ai-generated-section:v1:983729b3d7acbbd8604c2118bbd2e1a9cb3bd327b77b614ed2bea9c9f4a6bc0e -->

`npm run dev:api` sets `VERCEL=1` to serve the API without a built client shell. Set `HOST` to override the standalone API listener. The managed stack fixes the API listener, readiness probe, and Vite proxy target at `127.0.0.1:3080`, overriding `HOST` and `PORT` for that child. A production run (`npm run backend`) still serves the compiled client.

<!-- /coderabbit-ai-generated:v1 -->

Endpoints and models come from `coderax.yaml`.

## UI

```bash
cd client && HOST=0.0.0.0 PORT=3000 npm run dev
```

Vite proxies `/api` and `/oauth` to the API on port 3080.
