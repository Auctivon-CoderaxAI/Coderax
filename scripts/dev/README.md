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

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:5a4b42942830c23951e16cb10a76dabe90c502a1104493133fe3d109c538198a -->

Configure the [API environment](#api), then start the stack. Replace
`preview.example.com` with your preview hostname:

```bash
CODERAX_PREVIEW_HOST=preview.example.com npm run dev:up
npm run dev:down
npm run dev:status
```

<!-- /coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:235f07bf78c167e21f860583aa67565b4f62ad9744235b92e1d10aae58e3bc1d -->

`dev:up` starts MongoDB, the API, the local model and Vite in order, waiting until
each answers before moving on; `dev:down` stops them in reverse order. Each
service runs in its own process group and writes a log to `.dev/logs/`. The
record in `.dev/pids/` has a marker that the service and its children inherit.
Shutdown checks for that marker before signaling a group, even if its original
leader has exited. If a group cannot be verified or stopped, its record is kept
and `dev:down` exits nonzero. Running `dev:up` again reuses services that are
already healthy.

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:263869b15449cad8b3e54f523de5f07d704234c62190c043689311dd1721fa34 -->

Only one `dev:up` or `dev:down` can run at a time. After Ctrl+C interrupts
startup, run `npm run dev:down` to stop any services already started. If an
abrupt termination leaves `.dev/stack.lock`, confirm that neither command is
running before using `rmdir .dev/stack.lock`. To upgrade a running stack, stop it with your old
checkout first. The new supervisor cannot verify a running group from an old
PID or start time record alone. If you already upgraded, identify and stop any
old stack processes manually before removing their records.

<!-- /coderabbit-ai-generated:v1 -->

<!-- /coderabbit-ai-generated:v1 -->

`dev:status` reads the same PID files and reports each service's PID, port and
readiness without starting or stopping anything; it flags stale PID files and
ports held by other processes, and exits non-zero when a service is missing or
unready.

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:3362b213c805a161afcde94bbac36066a8a8652e193a90602299f14a6a04b1cd -->

The managed UI listens on `127.0.0.1:3000` by default. Setting
`CODERAX_PREVIEW_HOST` (or `VITE_ALLOWED_HOSTS`) opts in to a listener on all IPv4
interfaces and tells Vite which preview hostname to accept. Network preview
requires `TRUST_TENANT_HEADER` to be disabled. Stop the stack before upgrading a
running instance or switching preview modes. The model is skipped with a
warning when its binary or weights are missing.

<!-- /coderabbit-ai-generated:v1 -->

## MongoDB

```bash
npm run dev:mongo   # 127.0.0.1:27017, database Coderax; Ctrl+C stops it
```

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:96130fd59afb230eec0383cb772bf81cac5b525e78a1871caa403b1116f363e2 -->

- Data lives in `.dev/mongo/data` (gitignored) and survives restarts.
- The first run downloads a `mongod` binary through `mongodb-memory-server`, so
  `npm ci` must have run first.
- `CODERAX_MONGO_PORT` overrides the managed port. MongoDB refuses to start if
  that port is already in use. In `dev:up`, omit `MONGO_URI` to use the managed
  port and the `Coderax` database. If you set `MONGO_URI`, it must name only
  `127.0.0.1` on the managed port. Stop the stack before changing its MongoDB
  settings. For standalone `dev:api`, set `MONGO_URI` to the database you want
  to use.

<!-- /coderabbit-ai-generated:v1 -->

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

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:3fbea88cd7a6ff04c1ad366103a8efd454f3bf923f01d7e978c0d8a27d2977b6 -->

Vite proxies `/api` and `/oauth` to the API on port 3080 by default.

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:f11374dd12812c791e17e736756327fd7928167e15a4fdb8e1a8eb64db898028 -->

With `dev:up`, the API listener, readiness probe and Vite proxy share the API
address configured by `HOST` and `PORT`. Shell variables take precedence over
`.env`. The supervisor requires a fixed port. If the API address or preview
hostname changes, run `npm run dev:down` before starting again. The supervisor
refuses to reuse a running API or UI when its recorded settings differ or are
missing. Shutdown still verifies ownership of processes started by older versions.

<!-- /coderabbit-ai-generated:v1 -->

<!-- /coderabbit-ai-generated:v1 -->
