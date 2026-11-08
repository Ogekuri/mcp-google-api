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
#  * release version guard. Artifact hygiene: an EXIT trap removes every artifact
#  * directory the stages created during the run, such as the tsup `dist/` tree
#  * (PKG-061), while directories that pre-existed before the run are preserved
#  * (PKG-062), so the repository is left as found on both success and failure.
#  * @return Exit code 0 when all stages pass; 1 at the first failed stage.
#  * @post On any exit, artifact directories created during the run are removed;
#  *       pre-existing artifact directories are left untouched.
#  * @pre Repository root contains `package.json`; the npm toolchain is on PATH.
#  * @note Runnable from any cwd: the repository root is resolved from the script
#  *       location, mirroring `scripts/mcp-google-api.sh`.
#  * @satisfies PKG-058, PKG-059, PKG-060, PKG-061, PKG-062, PKG-019
#  */
set -euo pipefail
cd "$(dirname "$0")/.."

# Pre-run artifact snapshot (PKG-061, PKG-062): 1 when the build artifact tree
# existed before this run, 0 when this run creates it.
ARTIFACT_PREEXISTED=0
if [ -d dist ]; then
  ARTIFACT_PREEXISTED=1
fi

# /**
#  * @brief Removes build artifacts this run created, leaving the repository as found.
#  * @details Registered as an EXIT trap so both the success path (`exit 0`) and the
#  * fail-fast path (`exit 1` from `run_stage`) restore the repository state (PKG-061,
#  * PKG-062). Removes the artifact directory tree produced by the stages only when it
#  * did not exist before the run; pre-existing artifact directories are preserved
#  * untouched. Complexity O(tree size) on the removal path, O(1) otherwise.
#  * @side_effect Deletes `dist/` when this run created it; prints a cleanup note on stdout.
#  * @satisfies PKG-061, PKG-062
#  */
cleanup_artifacts() {
  if [ "$ARTIFACT_PREEXISTED" -eq 0 ] && [ -d dist ]; then
    rm -rf dist
    printf '[pre-release-check] removed build artifacts (dist/) created by this run.\n'
  fi
}
trap cleanup_artifacts EXIT

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
