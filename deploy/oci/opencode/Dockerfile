# syntax=docker/dockerfile:1
#
# Official OpenCode runtime for the Oracle Always Free A1 (linux/arm64)
# backend.
#
# The version is pinned and must stay equal to `@opencode-ai/sdk` in
# packages/api/package.json: the SDK and the server share one API contract, and
# OpenCode V2 is a different contract. `opencode --version` is asserted at build
# time so a tag mismatch cannot ship silently.
#
# No model weights, GPU, or local inference runtime are installed. The server
# reaches a hosted OpenAI-compatible provider over outbound HTTPS only.
FROM node:22-bookworm-slim

ARG OPENCODE_VERSION=1.19.6

# git: OpenCode's workspace snapshots. ripgrep: its search tool. tini: PID 1 so
# the server receives SIGTERM and exits cleanly. curl: the healthcheck.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    git \
    ripgrep \
    tini \
  && rm -rf /var/lib/apt/lists/*

# Install the published Linux build for this image's architecture. npm resolves
# the matching `opencode-linux-<arch>` optional dependency, so the same Dockerfile
# serves the ARM64 Always Free shape and an x64 host. Optional dependencies must
# be included explicitly.
RUN npm install --global --include=optional --no-audit --no-fund \
    "opencode-ai@${OPENCODE_VERSION}" \
  && test "$(opencode --version)" = "${OPENCODE_VERSION}"

# The app container runs as the base image's `node` user (uid 1000) and mounts
# the same workspace volume. Sharing the uid is what makes the confined run
# directory writable by the server without a privileged chown at startup.
RUN mkdir -p /config/opencode /data /data/home /data/cache /srv/engine \
  && chown -R node:node /config /data /srv/engine

# Global OpenCode configuration. Provider credentials are referenced, never
# embedded; the server resolves {env:...} from its own environment at startup.
COPY --chown=node:node opencode.json /config/opencode/opencode.json
COPY --chmod=0755 entrypoint.sh /usr/local/bin/entrypoint.sh
COPY --chmod=0755 healthcheck.sh /usr/local/bin/healthcheck.sh

# A confined, persistent state root: sessions, snapshots and the provider cache
# live under /data, which compose mounts from a named volume.
ENV HOME=/data/home \
    XDG_DATA_HOME=/data \
    XDG_CONFIG_HOME=/config \
    XDG_CACHE_HOME=/data/cache \
    OPENCODE_PORT=4096 \
    OPENCODE_SERVER_USERNAME=opencode \
    NODE_ENV=production

USER node
WORKDIR /srv/engine

# The port is never published; only the Coderax app on the private compose
# network is expected to reach it.
EXPOSE 4096

HEALTHCHECK --interval=15s --timeout=6s --start-period=25s --retries=4 \
  CMD ["/usr/local/bin/healthcheck.sh"]

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
