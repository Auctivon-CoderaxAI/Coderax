# v0.8.8

# Base node image
FROM node:24.16.0-alpine AS node

RUN apk upgrade --no-cache
RUN apk add --no-cache jemalloc
RUN apk add --no-cache python3 py3-pip uv

# Set environment variable to use jemalloc
ENV LD_PRELOAD=/usr/lib/libjemalloc.so.2
# Disable dependency installation analytics before any npm lifecycle scripts run.
ENV SCARF_ANALYTICS=false

# Add `uv` for extended MCP support
COPY --from=ghcr.io/astral-sh/uv:0.9.5-python3.12-alpine /usr/local/bin/uv /usr/local/bin/uvx /bin/
RUN uv --version

# Set configurable max-old-space-size with default
ARG NODE_MAX_OLD_SPACE_SIZE=6144
ARG NPM_CI_TIMEOUT_SECONDS=1500
ARG NPM_CI_ATTEMPTS=2

RUN mkdir -p /app && chown node:node /app
WORKDIR /app

USER node

COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node api/package.json ./api/package.json
COPY --chown=node:node client/package.json ./client/package.json
COPY --chown=node:node packages/data-provider/package.json ./packages/data-provider/package.json
COPY --chown=node:node packages/data-schemas/package.json ./packages/data-schemas/package.json
COPY --chown=node:node packages/api/package.json ./packages/api/package.json

RUN \
    # Allow mounting of these files, which have no default
    touch .env ; \
    # Create directories for the volumes to inherit the correct permissions
    mkdir -p /app/client/public/images /app/logs /app/uploads /app/skill /app/data ; \
    chmod 1777 /app/data ; \
    npm config set fetch-retry-maxtimeout 600000 ; \
    npm config set fetch-retries 5 ; \
    npm config set fetch-retry-mintimeout 15000 ; \
    attempt=1 ; \
    until timeout "$NPM_CI_TIMEOUT_SECONDS" npm ci --no-audit ; do \
        status=$? ; \
        if [ "$attempt" -ge "$NPM_CI_ATTEMPTS" ]; then \
            exit "$status" ; \
        fi ; \
        echo "npm ci --no-audit failed with exit code $status; retrying attempt $((attempt + 1))/$NPM_CI_ATTEMPTS" ; \
        attempt=$((attempt + 1)) ; \
        npm cache clean --force || true ; \
        sleep 10 ; \
    done

COPY --chown=node:node . .

ARG VITE_MCP_SANDBOX_URL=
RUN \
    # React client build with configurable memory
    NODE_OPTIONS="--max-old-space-size=${NODE_MAX_OLD_SPACE_SIZE}" npm run frontend && \
    npm prune --production && \
    npm cache clean --force

# Optional build metadata surfaced in Settings -> About for support triage.
# Declared here (after the heavy install/build steps) so that commit/date
# changing on every CI run does not bust the cache for dependency install
# and frontend build layers. When unset, the backend falls back to local
# git resolution (if .git is present), and finally to empty values.
ARG BUILD_COMMIT=
ARG BUILD_BRANCH=
ARG BUILD_DATE=
ENV BUILD_COMMIT=${BUILD_COMMIT}
ENV BUILD_BRANCH=${BUILD_BRANCH}
ENV BUILD_DATE=${BUILD_DATE}

# Node API setup
EXPOSE 3080
ENV HOST=0.0.0.0
ENV NODE_ENV=production
CMD ["node", "api/server/index.js"]

# --- Freebuff SDK ---------------------------------------------------------
# Work's Freebuff engine runs a source-built SDK that is not published to npm,
# so it arrives through an extra build context instead of being fetched:
#   docker build --build-context freebuff-sdk-src=../freebuff-main/sdk \
#     --target node-freebuff -t coderax:freebuff .
# docker-compose.yml declares that context and targets the stage below.
FROM node:24.16.0-alpine AS freebuff-sdk
ARG FREEBUFF_SDK_VERSION=0.10.7
WORKDIR /opt/freebuff-sdk
COPY --from=freebuff-sdk-src package.json /opt/freebuff-sdk/package.json
COPY --from=freebuff-sdk-src dist /opt/freebuff-sdk/dist
COPY docker/freebuff-sdk/package-lock.json /opt/freebuff-sdk/package-lock.json
# The bundle externalizes its dependencies, so they are installed here rather
# than shipped inside dist. The Linux production install is pinned by the
# lockfile in docker/freebuff-sdk/; no lifecycle scripts are needed here.
# Keep zod at 4.2.1: the bundled AI SDK's JSON-schema context has no `deferred`,
# and newer zod 4.x record processors call `ctx.deferred.push`, which crashes on
# set_output's z.record schema before the model request starts.
RUN set -eu; \
    test "$(node -p 'require("/opt/freebuff-sdk/package.json").version')" = "$FREEBUFF_SDK_VERSION"; \
    npm ci --omit=dev --no-audit --no-fund --ignore-scripts; \
    test "$(node -p 'require("/opt/freebuff-sdk/node_modules/zod/package.json").version')" = "4.2.1"; \
    node -e "const sdk = require('/opt/freebuff-sdk/dist/index.cjs'); for (const name of ['CodebuffClient', 'normalizeByokBaseUrl', 'isUntrustedAgentPublisherError']) { if (typeof sdk[name] !== 'function') throw new Error('Freebuff SDK is missing ' + name); }"
# The bundled ripgrep is architecture-specific and is staged into a temp file
# by the SDK; verify the copy that matches this image can actually execute.
RUN set -eu; \
    case "$(uname -m)" in \
      x86_64) rg=x64-linux ;; \
      aarch64) rg=arm64-linux ;; \
      *) echo "Unsupported Freebuff ripgrep architecture: $(uname -m)" >&2; exit 1 ;; \
    esac; \
    cp "/opt/freebuff-sdk/dist/vendor/ripgrep/$rg/rg" /tmp/rg; \
    chmod +x /tmp/rg; \
    /tmp/rg --version; \
    rm -f /tmp/rg

# Deployment image: the API plus a self-contained SDK at /opt/freebuff-sdk, so
# runtime never reads a host checkout. Other builds keep targeting the `node`
# stage and never need the SDK context.
FROM node AS node-freebuff
COPY --from=freebuff-sdk /opt/freebuff-sdk /opt/freebuff-sdk
# Private Work workspaces live on the persisted data volume.
RUN mkdir -p /app/data/freebuff-workspace
ENV FREEBUFF_SDK_PATH=/opt/freebuff-sdk/dist/index.cjs

# Default target (the last stage): the API image without the SDK, so plain
# `docker build .` and stacks that do not run Work build exactly as before and
# never need the extra context. Docker Compose targets `node-freebuff` above.
FROM node AS default

# Optional: for client with nginx routing
# FROM nginx:stable-alpine AS nginx-client
# WORKDIR /usr/share/nginx/html
# COPY --from=node /app/client/dist /usr/share/nginx/html
# COPY client/nginx.conf /etc/nginx/conf.d/default.conf
# ENTRYPOINT ["nginx", "-g", "daemon off;"]
