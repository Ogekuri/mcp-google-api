#!/usr/bin/env bash
# /**
#  * @file pre-release-check.sh
#  * @brief Runs every release-gating check required before an official npm release.
#  * @details Executes from the repository root, in fail-fast order (PKG-059, PKG-080):
#  * 0. Preflight (PKG-081, PKG-083): `git`, `node`, `npm`, `diff`, `cmp` on PATH; Node.js >= 24;
#  *    installed `node_modules/.bin/{tsc,tsup,tsx}`; git work tree; a private temporary work directory
#  *    located outside the repository working tree (PKG-061); the `git status --porcelain --ignored`
#  *    snapshot (PKG-082). Every missing toolchain item is collected first and named together in one
#  *    aggregated diagnostic, so a single run reports each missing prerequisite (PKG-081). Never installs.
#  * 1. `npm run check:publish-version` - publish version guard (PKG-017, PKG-057).
#  * 2. `npm run typecheck` - TypeScript type surface (`tsc --noEmit`).
#  * 3. `npm test` - full unit suite (live e2e excluded, TST-010).
#  * 4. Test build (PKG-061): `node_modules/.bin/tsup --out-dir <private temp build directory>` emits
#  *    the production ESM runtime bundle outside the repository working tree.
#  * 5. Temporary artifact verification (PKG-080): the emitted `cli.js` entry MUST
#  *    exist, be non-empty, and pass `node --check`.
#  * Cleanup and integrity (EXIT trap, PKG-084..PKG-086): the final `git status --porcelain --ignored`
#  * output is compared with the pre-run snapshot (PKG-082) and the private temporary work directory is
#  * removed (PKG-084). The original failing exit status is never overwritten (PKG-085). A passing run
#  * whose cleanup or integrity check fails exits 1 (PKG-086). Signals HUP, INT, TERM exit through the
#  * same trap with status 129, 130, 143 (PKG-087). No dependency install, no package publication
#  * (PKG-060), and no destructive git command (PKG-088).
#  * @return Exit code 0 only when every stage passes and cleanup plus integrity verification succeed;
#  *         1 at the first failed stage or cleanup/integrity failure.
#  * @pre Dependencies installed beforehand by the project package manager; repository is a git work tree.
#  * @post No artifact created by the run remains; the private temporary work directory is removed;
#  *       tracked, untracked, and ignored repository state equals the pre-run snapshot.
#  * @note Independent of the repository `dist/` directory: this script neither creates, modifies,
#  *       deletes, cleans, reads, nor validates any `dist/` entry (PKG-062, PKG-123, PKG-124).
#  *       Runnable from any working directory; the repository root is resolved from the script location.
#  * @satisfies PKG-058, PKG-059, PKG-060, PKG-061, PKG-062, PKG-080, PKG-081, PKG-082, PKG-083,
#  *            PKG-084, PKG-085, PKG-086, PKG-087, PKG-088, PKG-089, PKG-123, PKG-124
#  */
set -euo pipefail
cd "$(dirname "$0")/.."

readonly MIN_NODE_MAJOR=24
# Absolute repository root used to prove that the temporary work directory stays outside it (PKG-061).
readonly REPO_ROOT="$PWD"

# Phase label of the stage in progress; reported on failure (PKG-089).
CURRENT_PHASE="preflight"
# 1 once the pre-run `git status` snapshot exists (PKG-082).
REPO_SNAPSHOT_READY=0
# Private temporary work directory outside the repository working tree (PKG-061).
WORKDIR=""
# Private temporary build output directory below WORKDIR (PKG-061).
BUILD_DIR=""
# Missing toolchain items collected by the preflight so one run names every missing item (PKG-081).
MISSING_PREREQUISITES=()

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
#  * @details Prints `<phase>: FAILED: <message>` and exits 1; the EXIT trap then removes the private
#  * temporary work directory (PKG-084, PKG-085). Complexity O(1).
#  * @param message {string} Diagnostic naming the failed check.
#  * @return {void} Never returns.
#  * @side_effect Terminates the process with exit code 1.
#  */
fail() {
  printf '[pre-release-check] %s: FAILED: %s\n' "$CURRENT_PHASE" "$*" >&2
  exit 1
}

# /**
#  * @brief Records one unresolvable PATH command as a missing prerequisite.
#  * @details Appends a diagnostic to `MISSING_PREREQUISITES` instead of aborting, so the preflight
#  * reports every missing item in one aggregated failure (PKG-081). Complexity O(1).
#  * @param name {string} Command name, e.g. `git`.
#  * @return {void}
#  * @side_effect Appends to `MISSING_PREREQUISITES` when the command is absent.
#  * @satisfies PKG-081
#  */
collect_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    MISSING_PREREQUISITES+=("required command not found on PATH: $1")
  fi
}

# /**
#  * @brief Records one absent installed dependency binary as a missing prerequisite.
#  * @details Installation is never performed by this script (PKG-060); the binary must already exist.
#  * A missing binary is appended to `MISSING_PREREQUISITES` so `tsc`, `tsup`, and `tsx` are all named
#  * by a single preflight run (PKG-081). Complexity O(1).
#  * @param name {string} Binary name, e.g. `tsup`.
#  * @return {void}
#  * @side_effect Appends to `MISSING_PREREQUISITES` when the binary is absent or not executable.
#  * @satisfies PKG-081
#  */
collect_binary() {
  if [ ! -x "node_modules/.bin/$1" ]; then
    MISSING_PREREQUISITES+=("installed dependency binary missing: node_modules/.bin/$1 (dependencies must be installed beforehand)")
  fi
}

# /**
#  * @brief Records an unusable Node.js engine as a missing prerequisite.
#  * @details Skips silently when `node` itself is absent, because `collect_command` already recorded
#  * that item. An unreadable or non-numeric major version and a major version below
#  * `MIN_NODE_MAJOR` (CTN-005) are appended to `MISSING_PREREQUISITES` (PKG-081). Complexity O(1).
#  * @return {void}
#  * @side_effect Appends to `MISSING_PREREQUISITES` when the engine floor is violated.
#  * @satisfies PKG-081
#  */
collect_node_engine() {
  local node_major
  if ! command -v node >/dev/null 2>&1; then
    return 0
  fi
  if ! node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)"; then
    MISSING_PREREQUISITES+=("could not determine the Node.js major version; Node.js >= $MIN_NODE_MAJOR required (CTN-005)")
    return 0
  fi
  case "$node_major" in
    '' | *[!0-9]*) MISSING_PREREQUISITES+=("could not determine the Node.js major version; Node.js >= $MIN_NODE_MAJOR required (CTN-005)") ;;
    *)
      if [ "$node_major" -lt "$MIN_NODE_MAJOR" ]; then
        MISSING_PREREQUISITES+=("Node.js >= $MIN_NODE_MAJOR required (CTN-005), found major $node_major")
      fi
      ;;
  esac
}

# /**
#  * @brief Aborts the preflight naming every collected missing prerequisite.
#  * @details Prints one `MISSING` line per collected item on stderr, then aborts through `fail` with a
#  * single FAILED header carrying the item count, so one run reports each missing item (PKG-081) and
#  * the EXIT trap still removes the private work directory (PKG-084, PKG-085). Returns without output
#  * when nothing is missing. Complexity O(items).
#  * @return {void} Returns when every collected prerequisite is present.
#  * @throws {exit 1} Via `fail` when at least one prerequisite is missing.
#  * @side_effect Writes diagnostics to stderr and terminates the process on failure.
#  * @satisfies PKG-081
#  */
report_missing_prerequisites() {
  if [ "${#MISSING_PREREQUISITES[@]}" -eq 0 ]; then
    return 0
  fi
  local item
  for item in "${MISSING_PREREQUISITES[@]}"; do
    printf '[pre-release-check] %s: MISSING: %s\n' "$CURRENT_PHASE" "$item" >&2
  done
  fail "${#MISSING_PREREQUISITES[@]} missing prerequisite(s); install the declared dependencies beforehand"
}

# /**
#  * @brief Classifies one path as located outside the repository working tree.
#  * @details Byte-prefix comparison against the absolute repository root; pure, O(n) in path length.
#  * @param path {string} Absolute candidate path.
#  * @return {number} 0 when the path is outside the repository root; 1 when it equals or lies below it.
#  */
is_outside_repository() {
  case "$1" in
    "$REPO_ROOT" | "$REPO_ROOT"/*) return 1 ;;
    *) return 0 ;;
  esac
}

# /**
#  * @brief Executes every preflight check and records the repository and work-directory state.
#  * @details Order: required commands, Node.js major >= 24 (CTN-005), and installed dependency
#  * binaries are collected first and reported together in one aggregated diagnostic naming every
#  * missing item (PKG-081); then the git work tree (PKG-083), the private temporary work directory
#  * outside the repository working tree (PKG-061), and the `git status --porcelain --ignored` snapshot
#  * (PKG-082). Complexity O(repository status size).
#  * @return {void}
#  * @side_effect Creates `$WORKDIR` under the OS temp root and `$WORKDIR/repo-before.txt`.
#  * @throws {exit 1} Via `fail` when any prerequisite is missing or a snapshot step fails.
#  * @satisfies PKG-081, PKG-082, PKG-083
#  */
run_preflight() {
  CURRENT_PHASE="preflight"
  collect_command git
  collect_command node
  collect_command npm
  collect_command diff
  collect_command cmp
  collect_node_engine
  collect_binary tsc
  collect_binary tsup
  collect_binary tsx
  report_missing_prerequisites
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    fail "repository is not a git work tree; integrity cannot be verified (PKG-083)"
  fi
  if ! WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/pre-release-check.XXXXXX")"; then
    fail "could not create the private temporary work directory"
  fi
  BUILD_DIR="$WORKDIR/build"
  if ! is_outside_repository "$WORKDIR"; then
    fail "temporary work directory must live outside the repository working tree (PKG-061): $WORKDIR"
  fi
  if ! git status --porcelain --ignored >"$WORKDIR/repo-before.txt"; then
    fail "git status failed while recording the pre-run snapshot"
  fi
  REPO_SNAPSHOT_READY=1
  log "preflight: toolchain, dependency binaries, repository snapshot, and temporary work directory ready"
}

# /**
#  * @brief Emits the production ESM bundle into the private temporary build directory.
#  * @details Runs the installed `tsup` binary with `--out-dir $BUILD_DIR`, so the emitted entry never
#  * touches the repository working tree (PKG-061). A `{ "type": "module" }` marker is
#  * written first so the emitted `.js` entries are parsed as ECMAScript modules by `node --check`
#  * (CTN-006). The repository `dist/` directory is never created, modified, or cleaned
#  * (PKG-062, PKG-123). Failure handling is explicit because `run_stage` invokes this function as a
#  * conditional command, where `set -e` does not abort. Complexity O(bundle size).
#  * @return {void} Returns only on a successful compile.
#  * @throws {exit 1} Via `fail` when the binary, directory, or compile step fails (PKG-080, PKG-081).
#  * @side_effect Writes `$BUILD_DIR` contents only.
#  */
build_into_temp_dir() {
  local tsup_bin="node_modules/.bin/tsup"
  if [ -z "$BUILD_DIR" ]; then
    fail "temporary build directory is not initialized"
  fi
  if [ ! -x "$tsup_bin" ]; then
    fail "installed dependency binary missing: $tsup_bin (dependencies must be installed beforehand)"
  fi
  if ! mkdir -p "$BUILD_DIR"; then
    fail "could not create the temporary build directory: $BUILD_DIR"
  fi
  if ! printf '{\n  "type": "module"\n}\n' >"$BUILD_DIR/package.json"; then
    fail "could not write the module marker into the temporary build directory: $BUILD_DIR"
  fi
  log "build: emitting the ESM bundle into the private temporary build directory $BUILD_DIR"
  if ! "$tsup_bin" --out-dir "$BUILD_DIR"; then
    fail "tsup build into the temporary build directory failed"
  fi
}

# /**
#  * @brief Verifies the emitted temporary build artifacts (PKG-080).
#  * @details Requires `$BUILD_DIR/cli.js` to exist, be non-empty, and pass
#  * `node --check`. No repository entry is read or validated (PKG-123). Complexity O(entry size).
#  * @return {void} Returns only when every emitted entry verifies.
#  * @throws {exit 1} Via `fail` when an entry is missing, empty, or syntactically invalid.
#  * @side_effect Writes verification lines to stdout.
#  */
verify_temp_build() {
  local entry
  local entry_path
  if [ -z "$BUILD_DIR" ] || [ ! -d "$BUILD_DIR" ]; then
    fail "temporary build directory is missing: ${BUILD_DIR:-<unset>}"
  fi
  for entry in cli.js; do
    entry_path="$BUILD_DIR/$entry"
    if [ ! -f "$entry_path" ] || [ ! -s "$entry_path" ]; then
      fail "temporary build entry missing or empty: $entry_path"
    fi
    if ! node --check "$entry_path"; then
      fail "temporary build entry failed node --check: $entry_path"
    fi
    log "artifact verification: $entry exists, is non-empty, and passes node --check"
  done
}

# /**
#  * @brief Executes one release-gating stage and aborts the pipeline on first failure.
#  * @details Prints a running header naming the stage and its command tokens, executes the command
#  * (shell function or executable) with inherited stdio, prints a PASS line on exit code 0, or prints a
#  * FAILED diagnostic on stderr and exits 1 so no later stage runs (PKG-059). Records the stage label as
#  * CURRENT_PHASE (PKG-089). Complexity O(1) plus the stage runtime.
#  * @param stage_label {string} Human-readable stage name printed in headers and diagnostics.
#  * @param command {string...} Command tokens or shell-function name executed verbatim.
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
#  * @brief Compares the final repository state with the pre-run snapshot.
#  * @details Recomputes `git status --porcelain --ignored` and requires byte equality with the pre-run
#  * snapshot, covering tracked, untracked, and git-ignored leftovers (PKG-082). Prints a unified `diff`
#  * on mismatch. Complexity O(repository status size).
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
#  * @brief Removes the private temporary work directory and every build artifact inside it.
#  * @details Removes `$WORKDIR` only; no repository path is touched (PKG-062, PKG-084). An absent or
#  * never-created work directory is a successful no-op. Complexity O(temporary tree size).
#  * @return {number} 0 on success; 1 when removal fails.
#  * @side_effect Deletes `$WORKDIR` from the OS temp root.
#  */
cleanup_workdir() {
  if [ -z "$WORKDIR" ] || [ ! -d "$WORKDIR" ]; then
    return 0
  fi
  if ! rm -rf "$WORKDIR"; then
    printf '[pre-release-check] cleanup: FAILED: could not remove temporary work directory %s\n' "$WORKDIR" >&2
    return 1
  fi
  log "cleanup: removed the private temporary work directory (PKG-084)"
  return 0
}

# /**
#  * @brief EXIT trap: integrity verification, cleanup, and final result line.
#  * @details Captures the script exit status first and preserves it (PKG-085). Verifies repository
#  * integrity (PKG-082) and then removes the private temporary work directory (PKG-084). Exits with the
#  * original status on failure; exits 1 when a passing run fails integrity or cleanup (PKG-086); prints
#  * the PASS result only when everything succeeded (PKG-089).
#  * @return {void} Terminates with the resulting exit status.
#  * @side_effect Removes `$WORKDIR`, writes the result line.
#  */
on_exit() {
  local exit_status=$?
  local failed_phase="$CURRENT_PHASE"
  local cleanup_status=0
  trap - EXIT
  # Integrity is compared only when a pre-run snapshot exists; a failed preflight ran no stage (PKG-082).
  if [ "$REPO_SNAPSHOT_READY" -eq 1 ] || [ "$exit_status" -eq 0 ]; then
    if ! verify_repository_integrity; then
      cleanup_status=1
    fi
  fi
  if ! cleanup_workdir; then
    cleanup_status=1
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
run_stage 'build' build_into_temp_dir
run_stage 'artifact verification' verify_temp_build
