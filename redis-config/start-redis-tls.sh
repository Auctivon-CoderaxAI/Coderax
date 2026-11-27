#!/usr/bin/env bash

# Start Redis with the TLS configuration that sits beside this script.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# Redis sets its process title to the configured listening address.
if pgrep -fx '([^[:space:]]*/)?redis-server 127[.]0[.]0[.]1:6380' > /dev/null; then
    echo "Redis with TLS is already running"
    exit 1
fi

cd "$SCRIPT_DIR"
exec redis-server redis-tls.conf
