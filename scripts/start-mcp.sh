#!/usr/bin/env bash
# start-mcp.sh — run the MCP server over stdio from the ready dist artifact
# (for MCP clients: pi, Claude Desktop, Cursor, ...). No implicit builds.
# Extra args are forwarded to the CLI.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f dist/cli.js ]; then
  echo "dist/cli.js missing — build first: npm ci && npm run build (see README Quick Start)" >&2
  exit 1
fi

# stdout is reserved for JSON-RPC: all server logs already go to stderr
exec node dist/cli.js --stdio "$@"
