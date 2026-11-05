#!/usr/bin/env bash
# setup.sh — developer setup: install dependencies from the lockfile and
# scaffold .env when absent (never overwrites an existing .env)
set -euo pipefail
cd "$(dirname "$0")/.."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "${NODE_MAJOR:-0}" -lt 24 ]; then
  echo "ERROR: Node.js >= 24 required (found $(node -v))" >&2
  exit 1
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example — edit it and set GOOGLE_MAPS_API_KEY."
fi

npm ci
echo
echo "Setup complete. Next steps:"
echo "  npm run build            # compile to dist/ (or: npm run verify for the full pipeline)"
echo "  node dist/cli.js doctor  # local self-check (no network)"
echo "  node dist/cli.js start --stdio # run MCP server (stdio)"
