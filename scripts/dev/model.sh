#!/usr/bin/env bash
# Start the workspace-local llama.cpp server used by `npm run dev:up`.
#
# Artifacts live under .dev/model so an archive or restart keeps them:
#   .dev/model/bin/llama-server              built server (with its .so files)
#   .dev/model/qwen2.5-1.5b-q4.gguf          model weights
# Run `npm run dev:model:setup` to download/build anything missing.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MODEL_DIR="${DEV_MODEL_DIR:-$ROOT/.dev/model}"
BIN="${LLAMA_SERVER_BIN:-$MODEL_DIR/bin/llama-server}"
GGUF="${LLAMA_MODEL_PATH:-$MODEL_DIR/qwen2.5-1.5b-q4.gguf}"
HOST="${DEV_MODEL_HOST:-127.0.0.1}"
PORT="${DEV_MODEL_PORT:-8080}"
ALIAS="${DEV_MODEL_ID:-qwen2.5-1.5b-instruct}"
CTX="${DEV_MODEL_CTX:-8192}"
SLOTS="${DEV_MODEL_SLOTS:-2}"
THREADS="${DEV_MODEL_THREADS:-$(nproc 2>/dev/null || echo 4)}"

if [[ ! -x "$BIN" ]]; then
  echo "[dev:model] llama-server not found at $BIN" >&2
  echo "[dev:model] run: npm run dev:model:setup" >&2
  exit 1
fi

if [[ ! -f "$GGUF" ]]; then
  echo "[dev:model] model weights not found at $GGUF" >&2
  echo "[dev:model] run: npm run dev:model:setup" >&2
  exit 1
fi

echo "[dev:model] $BIN -m $GGUF --host $HOST --port $PORT"
exec "$BIN" \
  --model "$GGUF" \
  --host "$HOST" \
  --port "$PORT" \
  --alias "$ALIAS" \
  --ctx-size "$CTX" \
  --parallel "$SLOTS" \
  --threads "$THREADS"
