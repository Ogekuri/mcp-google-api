#!/usr/bin/env bash
# start-http.sh — run the MCP server over Streamable HTTP from the ready dist
# artifact. Endpoint: http://<host>:<port>/mcp (host and port resolve from the
# persisted settings or --host/--port arguments). No implicit builds.
# SIGINT/SIGTERM stop orderly.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f dist/cli.js ]; then
  echo "dist/cli.js missing — build first: npm ci && npm run build" >&2
  exit 1
fi

exec node dist/cli.js start "$@"
