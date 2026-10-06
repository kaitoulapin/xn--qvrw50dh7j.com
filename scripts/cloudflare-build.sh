#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:$PATH"

if ! command -v rustup >/dev/null 2>&1; then
  installer=$(mktemp)
  trap 'rm -f "$installer"' EXIT
  curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location https://sh.rustup.rs -o "$installer"
  sh "$installer" -y --profile minimal --default-toolchain none
fi

rustup toolchain install 1.98.1 --profile minimal
rustup target add wasm32-unknown-unknown --toolchain 1.98.1
export RUSTUP_TOOLCHAIN=1.98.1
# Avoid re-entering the Cloudflare bootstrap from the child build.
unset WORKERS_CI
node scripts/build.js
