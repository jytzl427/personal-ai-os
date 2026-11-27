#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
export TZ=Asia/Shanghai

case "${1:-}" in
  setup)
    cache_dir="${PAIOS_CLOUD_CACHE_DIR:-${TMPDIR:-/tmp}/paios-codex-cache-$UID}"
    mkdir -p "$cache_dir"
    cache_dir="$(cd "$cache_dir" && pwd)"
    export COREPACK_HOME="$cache_dir/corepack" NODE_USE_ENV_PROXY=1
    export npm_config_cache="$cache_dir/npm-cache" npm_config_devdir="$cache_dir/node-gyp"
    export npm_config_build_from_source=true
    mkdir -p "$cache_dir/bin" "$cache_dir/headers" "$npm_config_cache" "$npm_config_devdir"
    corepack enable --install-directory "$cache_dir/bin" pnpm
    export PATH="$cache_dir/bin:$PATH"

    version="$(node --version)"
    archive="node-$version-headers.tar.gz"
    export npm_config_nodedir="$cache_dir/headers/node-$version"
    if [[ ! -f "$npm_config_nodedir/include/node/node.h" ]]; then
      curl -fsSL --retry 2 "https://nodejs.org/dist/$version/SHASUMS256.txt" -o "$cache_dir/headers/SHASUMS256.txt"
      curl -fsSL --retry 2 "https://nodejs.org/dist/$version/$archive" -o "$cache_dir/headers/$archive"
      (
        cd "$cache_dir/headers"
        awk -v archive="$archive" '$2 == archive { print }' SHASUMS256.txt | sha256sum -c -
        tar -xf "$archive"
      )
    fi
    pnpm install --frozen-lockfile --store-dir "$cache_dir/pnpm-store"
    pnpm build
    pnpm typecheck
    pnpm test
    ;;
  serve)
    : "${PAIOS_DATA_DIR:?Set PAIOS_DATA_DIR to an isolated test data directory}"
    export PAIOS_BIND=127.0.0.1
    export PAIOS_PORT="${PAIOS_PORT:-4738}"
    exec node apps/server/dist/main.js serve
    ;;
  *)
    echo "Usage: bash scripts/codex-linux.sh {setup|serve}" >&2
    exit 2
    ;;
esac
