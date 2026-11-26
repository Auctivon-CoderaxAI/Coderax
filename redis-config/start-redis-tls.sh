#!/usr/bin/env bash

# Start Redis with the TLS configuration that sits beside this script.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if pgrep -f redis-tls.conf > /dev/null; then
    echo "Redis with TLS is already running"
    exit 1
fi

echo "Starting Redis with TLS from ${SCRIPT_DIR}..."

# redis-tls.conf names its certificates relative to the server's working
# directory, so run from the directory that holds them.
cd "$SCRIPT_DIR"
exec redis-server "$SCRIPT_DIR/redis-tls.conf"
