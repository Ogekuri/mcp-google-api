#!/usr/bin/env bash
# /**
#  * @file pre-release-check.sh
#  * @brief Runs every release-gating check required before an official npm release.
#  * @details Executes, from the repository root, four stages in fixed order (PKG-059):
#  * 1. `npm run check:publish-version` — PKG-057/PKG-017 version guard rejecting
#  *    `0.0.0`-based, prerelease, or build-suffixed versions (PKG-006 identity).
#  * 2. `npm run typecheck` — TypeScript type surface (`tsc --noEmit`, CTN-006 ESM
#  *    constraints).
#  * 3. `npm test` — full unit suite (`tsx --test tests/*.unit.test.ts`,
#  *    TST-001..TST-024, live e2e excluded per TST-010).
#  * 4. `npm run build` — production tsup ESM build producing `dist/cli.js`
#  *    (PRJ-020, CTN-006).
#  * Abort semantics: stops at the first failed stage with exit code 1 (PKG-059);
#  * exit code 0 only when every stage passes (PKG-060). Never installs dependencies
#  * and never publishes (PKG-060); the prerequisite toolchain (node_modules) must
#  * already be present. Mirrors the PKG-019 `npm run verify` pipeline plus the
#  * release version guard.
#  * @return Exit code 0 when all stages pass; 1 at the first failed stage.
#  * @pre Repository root contains `package.json`; the npm toolchain is on PATH.
#  * @note Runnable from any cwd: the repository root is resolved from the script
#  *       location, mirroring `scripts/mcp-google-api.sh`.
#  * @satisfies PKG-058, PKG-059, PKG-060, PKG-019
#  */
set -euo pipefail
cd "$(dirname "$0")/.."

# /**
#  * @brief Executes one release-gating stage and aborts the pipeline on first failure.
#  * @details Prints a running header naming the stage and its command tokens, executes
#  * the command with inherited stdio, prints a `PASS` line on exit code 0, or prints a
#  * `FAILED` diagnostic on stderr and terminates the whole script with exit code 1 so
#  * no later stage runs (PKG-059, PKG-060). Complexity O(1) per stage.
#  * @param stage_label {string} Human-readable stage name printed in headers and diagnostics.
#  * @param command {string...} Command tokens executed verbatim with inherited stdio.
#  * @return Never returns on failure (exits 1); returns 0 on stage success.
#  * @side_effect Streams stage output to stdout and failure diagnostics to stderr.
#  */
run_stage() {
  local stage_label="$1"
  shift
  printf '[pre-release-check] %s: running: %s\n' "$stage_label" "$*"
  if "$@"; then
    printf '[pre-release-check] %s: PASS\n' "$stage_label"
  else
    local stage_status=$?
    printf '[pre-release-check] %s: FAILED (exit %s)\n' "$stage_label" "$stage_status" >&2
    exit 1
  fi
}

# Release-gating stages in mandatory order (PKG-059).
run_stage 'publish-version guard' npm run check:publish-version
run_stage 'typecheck' npm run typecheck
run_stage 'unit tests' npm test
run_stage 'build' npm run build

printf '[pre-release-check] all release-gating stages passed.\n'
exit 0
