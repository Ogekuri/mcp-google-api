#!/usr/bin/env bash
# build.sh — compile TypeScript sources to dist/ (no implicit setup chain)
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d node_modules ]; then
  echo "node_modules missing — run: npm ci" >&2
  exit 1
fi

npm run build
echo "Build OK → dist/"
