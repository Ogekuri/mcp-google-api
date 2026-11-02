#!/usr/bin/env bash
# test.sh — run the test suite (no implicit setup chain)
#   scripts/test.sh          → unit tests (no API key needed, service clients are mocked)
#   scripts/test.sh e2e      → smoke/e2e tests (requires GOOGLE_MAPS_API_KEY in .env)
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d node_modules ]; then
  echo "node_modules missing — run: npm ci" >&2
  exit 1
fi

if [ "${1:-}" = "e2e" ]; then
  exec npm run test:e2e
fi

exec npm test
