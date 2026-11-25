#!/bin/sh
# Headless OpenCode server entrypoint.
#
# Authentication is mandatory: the server listens on the private compose
# network, and a missing password would leave an unauthenticated
# remote-code-execution surface reachable from any container that joins that
# network. Fail closed.
set -eu

if [ -z "${OPENCODE_SERVER_PASSWORD:-}" ]; then
  echo 'OPENCODE_SERVER_PASSWORD is required; refusing to start an unauthenticated OpenCode server.' >&2
  exit 1
fi

# The app container runs as the same uid, so ordinary 0755 directories in the
# shared volume are writable by both processes without a privileged chown.
umask 022
mkdir -p /data/opencode /data/cache /data/home

# The cloud mode root Coderax confines runs to. It lives on the
# engine-workspace volume, which the app container mounts at the same absolute
# path, so the path Coderax validates is the path this server edits. The
# private root is on an app-only volume and is not mounted here.
mkdir -p /srv/engine/cloud
chmod 0755 /srv/engine/cloud

exec opencode serve \
  --hostname 0.0.0.0 \
  --port "${OPENCODE_PORT:-4096}" \
  --log-level "${OPENCODE_LOG_LEVEL:-INFO}" \
  --print-logs
