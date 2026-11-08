#!/usr/bin/env bash
# @file mcp-google-api.sh
# @brief Launch the local repository copy exactly like the installed
#        mcp-google-api distribution bin.
# @details Rebuilds the dist binaries from the current repository sources on
#          every invocation (PRJ-019), aborting non-zero when the rebuild
#          fails, then exec-replaces itself with `node dist/cli.js` so every
#          argument is forwarded unchanged and the CLI exit code propagates
#          (PRJ-022). Dependency installation stays an explicit manual step:
#          run `npm ci` once before the first invocation; the script never
#          installs dependencies (PRJ-019). Build output is routed to stderr
#          so the exec'd CLI owns stdout (stdio JSON-RPC framing, CTN-003).
# @pre Repository dependencies installed via `npm ci`.
# @post The executed CLI runs the freshly rebuilt dist binaries.
# @satisfies PRJ-018, PRJ-019, PRJ-022
set -euo pipefail
cd "$(dirname "$0")/.."

# Rebuild the dist binaries from the current sources on every run (PRJ-019);
# build output is routed to stderr so stdout stays reserved for the CLI.
npm run build --silent >&2

exec node dist/cli.js "$@"
