#!/usr/bin/env bash

# Start Redis with the TLS configuration that sits beside this script.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if pgrep -f redis-tls.conf > /dev/null; then
    echo "Redis with TLS is already running"
    exit 1
fi

cd "$SCRIPT_DIR"
exec redis-server redis-tls.conf