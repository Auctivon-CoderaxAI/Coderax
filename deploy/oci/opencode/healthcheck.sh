#!/bin/sh
# Readiness probe for the OpenCode server.
#
# It authenticates, so a 200 proves both that the process accepts connections
# and that the configured password is the one the server enforces. The
# credential is passed through curl's argument vector, never printed, and the
# container runs as an unprivileged user, so `ps` inside the container is the
# only exposure.
set -eu

port="${OPENCODE_PORT:-4096}"
user="${OPENCODE_SERVER_USERNAME:-opencode}"

code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 4 \
  -u "${user}:${OPENCODE_SERVER_PASSWORD:-}" \
  "http://127.0.0.1:${port}/global/health" || true)"

[ "$code" = "200" ]
