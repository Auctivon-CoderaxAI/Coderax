#!/usr/bin/env bash
# Download the GGUF and build llama.cpp into .dev/model.
# Used when `npm run dev:up` reports missing model artifacts.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MODEL_DIR="${DEV_MODEL_DIR:-$ROOT/.dev/model}"
GGUF="${LLAMA_MODEL_PATH:-$MODEL_DIR/qwen2.5-1.5b-q4.gguf}"
GGUF_URL="${DEV_MODEL_URL:-https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf}"
SRC="${LLAMA_CPP_SRC:-$MODEL_DIR/llama.cpp}"
BUILD="${DEV_MODEL_BUILD_DIR:-$MODEL_DIR/build}"
CMAKE="${CMAKE:-cmake}"

mkdir -p "$MODEL_DIR/bin"

if [[ ! -f "$GGUF" ]]; then
  echo "[dev:model:setup] downloading $(basename "$GGUF") (about 1 GB)"
  curl -fL --retry 3 -o "$GGUF.part" "$GGUF_URL"
  mv "$GGUF.part" "$GGUF"
else
  echo "[dev:model:setup] weights already present: $GGUF"
fi

if [[ ! -x "$MODEL_DIR/bin/llama-server" ]]; then
  if ! command -v "$CMAKE" >/dev/null 2>&1; then
    echo "[dev:model:setup] cmake is required to build llama-server." >&2
    echo "[dev:model:setup] install cmake and a C++ toolchain, or set CMAKE=/path/to/cmake." >&2
    exit 1
  fi
  if [[ ! -d "$SRC/.git" ]]; then
    echo "[dev:model:setup] cloning llama.cpp into $SRC"
    git clone --depth 1 https://github.com/ggml-org/llama.cpp "$SRC"
  fi
  echo "[dev:model:setup] building llama-server"
  "$CMAKE" -S "$SRC" -B "$BUILD" \
    -DCMAKE_BUILD_TYPE=Release \
    -DGGML_NATIVE=ON \
    -DLLAMA_CURL=OFF \
    -DLLAMA_BUILD_TESTS=OFF \
    -DLLAMA_BUILD_EXAMPLES=OFF
  "$CMAKE" --build "$BUILD" -j"$(nproc 2>/dev/null || echo 4)" --target llama-server
  cp -a "$BUILD/bin/." "$MODEL_DIR/bin/"
else
  echo "[dev:model:setup] server already built: $MODEL_DIR/bin/llama-server"
fi

echo "[dev:model:setup] ready under $MODEL_DIR"
echo "[dev:model:setup] start it with: npm run dev:model   (or npm run dev:up for the whole stack)"
