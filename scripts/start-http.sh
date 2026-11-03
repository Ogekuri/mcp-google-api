#!/usr/bin/env bash
# start-http.sh — run the MCP server over Streamable HTTP from the ready dist
# artifact. Endpoint: http://<host>:<port>/mcp (defaults: 127.0.0.1:3000,
# override via env or args). No implicit builds. SIGINT/SIGTERM stop orderly.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f dist/cli.js ]; then
  echo "dist/cli.js missing — build first: npm ci && npm run build (see README Quick Start)" >&2
  exit 1
fi

HOST="${MCP_SERVER_HOST:-127.0.0.1}"
PORT="${MCP_SERVER_PORT:-3000}"

exec node dist/cli.js start --host "$HOST" --port "$PORT" "$@"
