#!/usr/bin/env bash
# mcp-google-api.sh — run the local repository copy exactly like the installed
# mcp-google-api distribution bin: every argument is forwarded unchanged to
# the built dist entry (full CLI surface: doctor, exec, start, ...).
# No implicit builds; build first with: npm ci && npm run build.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f dist/cli.js ]; then
  echo "dist/cli.js missing — build first: npm ci && npm run build (see README Quick Start)" >&2
  exit 1
fi

exec node dist/cli.js "$@"
