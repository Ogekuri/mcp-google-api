#!/usr/bin/env bash
# /**
#  * @file pre-release-check.sh
#  * @brief Runs every release-gating check required before an official npm release.
#  * @details Executes from the repository root, in fail-fast order (PKG-059, PKG-080):
#  * 0. Preflight (PKG-081, PKG-083): `git`, `node`, `npm`, `tar`, `diff`, `cmp` on PATH; Node.js >= 24;
#  *    installed `node_modules/.bin/{tsc,tsup,tsx}`; git work tree. Records the `dist/` snapshot
#  *    (PKG-084) and the `git status --porcelain --ignored` snapshot (PKG-082). Never installs.
#  * 1. `npm run check:publish-version` - publish version guard (PKG-017, PKG-057).
#  * 2. `npm run typecheck` - TypeScript type surface (`tsc --noEmit`).
#  * 3. `npm test` - full unit suite (live e2e excluded, TST-010).
#  * 4. `npm run build` - production tsup ESM build (PRJ-020).
#  * 5. `bash scripts/build.sh` - release artifact generation into `dist/` (PKG-080).
#  * 6. `node tools/check-release-artifacts.mjs` - release artifact validation (PKG-075..PKG-079).
#  * Cleanup and integrity (EXIT trap, PKG-084..PKG-086): removes `dist/` when the run created it,
#  * restores the pre-run snapshot when it pre-existed, then compares the final
#  * `git status --porcelain --ignored` output with the pre-run snapshot (PKG-082).
#  * The original failing exit status is never overwritten (PKG-085). A passing run whose cleanup or
#  * integrity check fails exits 1 (PKG-086). Signals HUP, INT, TERM exit through the same trap
#  * with status 129, 130, 143 (PKG-087). No dependency install, no package publication (PKG-060),
#  * and no destructive git command (PKG-088).
#  * @return Exit code 0 only when every stage passes and cleanup plus integrity verification succeed;
#  *         1 at the first failed stage or cleanup/integrity failure.
#  * @pre Dependencies installed beforehand by the project package manager; repository is a git work tree.
#  * @post No artifact created by the run remains; `dist/` equals its pre-run state; tracked, untracked,
#  *       and ignored repository state equals the pre-run snapshot.
#  * @note Runnable from any working directory; the repository root is resolved from the script location.
#  * @satisfies PKG-058, PKG-059, PKG-060, PKG-061, PKG-062, PKG-080, PKG-081, PKG-082, PKG-083,
#  *            PKG-084, PKG-085, PKG-086, PKG-087, PKG-088, PKG-089
#  */
set -euo pipefail
cd "$(dirname "$0")/.."

readonly DIST_DIR="dist"

# Phase label of the stage in progress; reported on failure (PKG-089).
CURRENT_PHASE="preflight"
# dist/ state: unknown (no mutation allowed), absent (run creates it), preexisting (snapshot restored).
DIST_STATE="unknown"
DIST_SNAPSHOT_READY=0
REPO_SNAPSHOT_READY=0
# 1 when a user dist/ snapshot could not be restored; the work directory is then kept.
SNAPSHOT_RETAINED=0
WORKDIR=""

# /**
#  * @brief Prints one informational line on stdout with the script tag.
#  * @param message {string} Text printed after the tag.
#  * @return {void}
#  * @side_effect Writes to stdout.
#  */
log() {
  printf '[pre-release-check] %s\n' "$*"
}

# /**
#  * @brief Aborts the current phase with a FAILED diagnostic on stderr.
#  * @details Prints `<phase>: FAILED: <message>` and exits 1. The EXIT trap then runs cleanup
#  * (PKG-085). Complexity O(1).
#  * @param message {string} Diagnostic naming the failed check.
#  * @return {void} Never returns.
#  * @side_effect Terminates the process with exit code 1.
#  */
fail() {
  printf '[pre-release-check] %s: FAILED: %s\n' "$CURRENT_PHASE" "$*" >&2
  exit 1
}

# /**
#  * @brief Verifies that a command is resolvable on PATH.
#  * @param name {string} Command name.
#  * @return {void} Returns when the command exists.
#  * @throws {exit 1} Via `fail` when the command is absent (PKG-081).
#  */
require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "required command not found on PATH: $1"
  fi
}

# /**
#  * @brief Verifies that an installed dependency binary exists under node_modules/.bin.
#  * @details Installation is never performed by this script (PKG-060); the binary must already exist.
#  * @param name {string} Binary name, e.g. `tsup`.
#  * @return {void} Returns when the binary exists and is executable.
#  * @throws {exit 1} Via `fail` when the binary is absent (PKG-081).
#  */
require_binary() {
  if [ ! -x "node_modules/.bin/$1" ]; then
    fail "installed dependency binary missing: node_modules/.bin/$1 (dependencies must be installed beforehand)"
  fi
}

# /**
#  * @brief Snapshots a pre-existing dist/ directory into the work directory.
#  * @details Sets DIST_STATE to `preexisting` only after a complete copy (PKG-084); sets it to `absent`
#  * when dist/ does not exist. A failed copy leaves DIST_STATE `unknown`, so cleanup never removes a
#  * partially copied user directory. Complexity O(size of dist).
#  * @return {void}
#  * @side_effect Creates `$WORKDIR/dist-preexisting` when dist/ exists.
#  * @throws {exit 1} Via `fail` when dist exists but is not a directory or the copy fails.
#  */
snapshot_dist() {
  if [ -e "$DIST_DIR" ]; then
    if [ ! -d "$DIST_DIR" ]; then
      fail "$DIST_DIR exists but is not a directory"
    fi
    if ! cp -a "$DIST_DIR" "$WORKDIR/dist-preexisting"; then
      fail "could not snapshot pre-existing $DIST_DIR/"
    fi
    DIST_STATE="preexisting"
    DIST_SNAPSHOT_READY=1
  else
    DIST_STATE="absent"
  fi
}

# /**
#  * @brief Executes every preflight check and records the repository and dist/ snapshots.
#  * @details Order: work directory, required commands, Node.js major >= 24 (CTN-005), installed
#  * dependency binaries, git work tree (PKG-083), dist/ snapshot (PKG-084), and the
#  * `git status --porcelain --ignored` snapshot (PKG-082). Complexity O(repository status size).
#  * @return {void}
#  * @side_effect Creates `$WORKDIR` under the OS temp root and the snapshot files inside it.
#  * @throws {exit 1} Via `fail` on any missing prerequisite or snapshot failure.
#  */
run_preflight() {
  CURRENT_PHASE="preflight"
  WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/pre-release-check.XXXXXX")"
  require_command git
  require_command node
  require_command npm
  require_command tar
  require_command diff
  require_command cmp
  local node_major
  node_major="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "$node_major" -lt 24 ]; then
    fail "Node.js >= 24 required (CTN-005), found major $node_major"
  fi
  require_binary tsc
  require_binary tsup
  require_binary tsx
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    fail "repository is not a git work tree; integrity cannot be verified (PKG-083)"
  fi
  snapshot_dist
  if ! git status --porcelain --ignored >"$WORKDIR/repo-before.txt"; then
    fail "git status failed while recording the pre-run snapshot"
  fi
  REPO_SNAPSHOT_READY=1
  log "preflight: toolchain, dependency binaries, and repository snapshot ready"
}

# /**
#  * @brief Executes one release-gating stage and aborts the pipeline on first failure.
#  * @details Prints a running header naming the stage and its command tokens, executes the command
#  * with inherited stdio, prints a PASS line on exit code 0, or prints a FAILED diagnostic on stderr and
#  * exits 1 so no later stage runs (PKG-059). Records the stage label as CURRENT_PHASE (PKG-089).
#  * Complexity O(1) plus the stage runtime.
#  * @param stage_label {string} Human-readable stage name printed in headers and diagnostics.
#  * @param command {string...} Command tokens executed verbatim with inherited stdio.
#  * @return {void} Returns only on stage success.
#  * @throws {exit 1} When the stage command exits non-zero.
#  * @side_effect Streams stage output to stdout and failure diagnostics to stderr.
#  */
run_stage() {
  local stage_label="$1"
  shift
  CURRENT_PHASE="$stage_label"
  log "$stage_label: running: $*"
  if "$@"; then
    log "$stage_label: PASS"
  else
    local stage_status=$?
    printf '[pre-release-check] %s: FAILED (exit %s)\n' "$stage_label" "$stage_status" >&2
    exit 1
  fi
}

# /**
#  * @brief Removes or restores dist/ according to its recorded pre-run state.
#  * @details `preexisting`: removes dist/ and copies the snapshot back (PKG-084); the work directory
#  * is retained for manual recovery when this fails. `absent`: removes dist/ only when the run created
#  * it (PKG-061). `unknown`: performs no mutation. Complexity O(size of dist).
#  * @return {number} 0 on success; 1 when removal or restoration fails.
#  * @side_effect Mutates dist/ only.
#  */
cleanup_artifacts() {
  if [ "$DIST_STATE" = "preexisting" ]; then
    if [ "$DIST_SNAPSHOT_READY" -ne 1 ]; then
      printf '[pre-release-check] cleanup: FAILED: pre-run snapshot of %s/ is incomplete\n' "$DIST_DIR" >&2
      return 1
    fi
    # The snapshot is retained from the first destructive step until a complete restore (PKG-084).
    SNAPSHOT_RETAINED=1
    if ! rm -rf "$DIST_DIR"; then
      printf '[pre-release-check] cleanup: FAILED: could not remove %s/ before restoration (snapshot kept at %s)\n' "$DIST_DIR" "$WORKDIR" >&2
      return 1
    fi
    if ! cp -a "$WORKDIR/dist-preexisting" "$DIST_DIR"; then
      printf '[pre-release-check] cleanup: FAILED: could not restore pre-existing %s/ (snapshot kept at %s)\n' "$DIST_DIR" "$WORKDIR" >&2
      return 1
    fi
    SNAPSHOT_RETAINED=0
    log "cleanup: restored pre-existing $DIST_DIR/ snapshot (PKG-084)"
    return 0
  fi
  if [ "$DIST_STATE" = "absent" ] && [ -e "$DIST_DIR" ]; then
    if ! rm -rf "$DIST_DIR"; then
      printf '[pre-release-check] cleanup: FAILED: could not remove %s/ created by this run\n' "$DIST_DIR" >&2
      return 1
    fi
    log "cleanup: removed $DIST_DIR/ created by this run (PKG-061)"
  fi
  return 0
}

# /**
#  * @brief Compares the final repository state with the pre-run snapshot.
#  * @details Recomputes `git status --porcelain --ignored` and requires byte equality with the pre-run
#  * snapshot, covering tracked, untracked, and git-ignored leftovers (PKG-082). Prints a unified
#  * `diff` on mismatch. Complexity O(repository status size).
#  * @return {number} 0 when identical; 1 when different or unverifiable.
#  * @side_effect Writes `$WORKDIR/repo-after.txt`; writes diagnostics to stderr on mismatch.
#  */
verify_repository_integrity() {
  if [ "$REPO_SNAPSHOT_READY" -ne 1 ]; then
    printf '[pre-release-check] integrity: FAILED: no pre-run repository snapshot (PKG-082)\n' >&2
    return 1
  fi
  if ! git status --porcelain --ignored >"$WORKDIR/repo-after.txt"; then
    printf '[pre-release-check] integrity: FAILED: git status failed after the run\n' >&2
    return 1
  fi
  if cmp -s "$WORKDIR/repo-before.txt" "$WORKDIR/repo-after.txt"; then
    log "integrity: repository state matches the pre-run snapshot (tracked, untracked, ignored)"
    return 0
  fi
  printf '[pre-release-check] integrity: FAILED: repository state differs from the pre-run snapshot (PKG-082)\n' >&2
  diff "$WORKDIR/repo-before.txt" "$WORKDIR/repo-after.txt" >&2
  return 1
}

# /**
#  * @brief EXIT trap: cleanup, integrity verification, and final result line.
#  * @details Captures the script exit status first and preserves it (PKG-085). Runs cleanup and
#  * integrity verification unconditionally. Exits with the original status on failure; exits 1 when
#  * a passing run fails cleanup or integrity (PKG-086); prints the PASS result only when everything
#  * succeeded (PKG-089). The work directory is removed unless it holds an unrestored user dist/ snapshot.
#  * @return {void} Terminates with the resulting exit status.
#  * @side_effect Mutates dist/, removes `$WORKDIR` on success, writes the result line.
#  */
on_exit() {
  local exit_status=$?
  local failed_phase="$CURRENT_PHASE"
  local cleanup_status=0
  trap - EXIT
  if ! cleanup_artifacts; then
    cleanup_status=1
  fi
  # Integrity is compared only when a pre-run snapshot exists; a failed preflight ran no stage (PKG-082).
  if [ "$REPO_SNAPSHOT_READY" -eq 1 ] || [ "$exit_status" -eq 0 ]; then
    if ! verify_repository_integrity; then
      cleanup_status=1
    fi
  fi
  if [ "$SNAPSHOT_RETAINED" -eq 0 ] && [ -n "$WORKDIR" ]; then
    if ! rm -rf "$WORKDIR"; then
      printf '[pre-release-check] cleanup: FAILED: could not remove work directory %s\n' "$WORKDIR" >&2
      cleanup_status=1
    fi
  fi
  if [ "$exit_status" -ne 0 ]; then
    printf '[pre-release-check] RESULT: FAILED in phase "%s" (exit %s)\n' "$failed_phase" "$exit_status"
    if [ "$cleanup_status" -ne 0 ]; then
      printf '[pre-release-check] cleanup or integrity verification also failed; original exit status kept\n' >&2
    fi
    exit "$exit_status"
  fi
  if [ "$cleanup_status" -ne 0 ]; then
    printf '[pre-release-check] RESULT: FAILED in phase "cleanup and integrity verification" (exit 1)\n' >&2
    exit 1
  fi
  printf '[pre-release-check] RESULT: PASS (all release-gating stages passed; cleanup and integrity verified)\n'
  exit 0
}

trap on_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

run_preflight

# Release-gating stages in mandatory order (PKG-059, PKG-080).
run_stage 'publish-version guard' npm run check:publish-version
run_stage 'typecheck' npm run typecheck
run_stage 'unit tests' npm test
run_stage 'build' npm run build
run_stage 'release artifacts' bash scripts/build.sh
run_stage 'artifact validation' node tools/check-release-artifacts.mjs
