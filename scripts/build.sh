#!/usr/bin/env bash
# /**
#  * @file build.sh
#  * @brief Generates the mcp-google-api release artifacts into dist/.
#  * @details Standalone, repeatable release build (PKG-065) run from the repository
#  * root, in fail-fast order:
#  * 1. Preflight (PKG-067, PKG-068): Node.js >= 24, `node`, `npm`, `tar` on PATH and the
#  *    installed `node_modules/.bin/tsup` binary. Dependencies are never installed here.
#  * 2. Snapshot (PKG-073): a pre-existing `dist/` is copied to a private temp directory.
#  * 3. Compile (PKG-069): `npm run build` runs tsup (ESM bundle plus declarations). The
#  *    project tsup configuration sets `clean: true`, so tsup clears `dist/` first.
#  * 4. Compile verification (PKG-069, PKG-074): `dist/cli.js`, `dist/index.js`, `dist/cli.d.ts`,
#  *    and `dist/index.d.ts` must exist and be non-empty; `dist/cli.js` and `dist/index.js` must pass
#  *    `node --check`; every relative import target of both entries must exist and be non-empty.
#  * 5. Preservation (PKG-071, PKG-072): every non-generated snapshot file absent from the
#  *    new build is copied back into `dist/`. Generated files are never restored.
#  * 6. Pack (PKG-069, PKG-070): stale `*.tgz` removed, then
#  *    `npm pack --ignore-scripts --json --pack-destination dist`. The tarball name MUST equal
#  *    `<name>-<version>.tgz` from `package.json`; the tarball MUST be non-empty and readable by `tar`.
#  * 7. Summary (PKG-074): path and byte size of every file in `dist/`.
#  * Failure semantics (PKG-073): any failing phase exits non-zero. The EXIT trap then
#  * restores the pre-run `dist/` snapshot, or removes `dist/` when none pre-existed, so a
#  * failed build never leaves a partial output set. Signals HUP, INT, and TERM exit through the same trap.
#  * @return Exit code 0 when every artifact is generated and verified; 1 on failure;
#  *         129, 130, 143 on HUP, INT, TERM.
#  * @pre Dependencies installed beforehand by the project package manager.
#  * @post On success `dist/` contains the verified release artifacts; on failure `dist/`
#  *       equals its pre-run state.
#  * @note Runnable from any working directory (PKG-066); writes only under `dist/` and the OS temp directory.
#  * @satisfies PKG-065, PKG-066, PKG-067, PKG-068, PKG-069, PKG-070, PKG-071, PKG-072, PKG-073, PKG-074
#  */
set -euo pipefail
cd "$(dirname "$0")/.."

readonly DIST_DIR="dist"
readonly MIN_NODE_MAJOR=24

# Snapshot state of dist/: unknown (no mutation allowed), absent, or snapshot (copy in WORKDIR).
PREVIOUS_STATE="unknown"
# 1 when the previous dist/ snapshot could not be restored; the work directory is then kept.
SNAPSHOT_RETAINED=0
WORKDIR=""

# /**
#  * @brief Prints one informational line on stdout with the build tag.
#  * @param message {string} Text printed after the tag.
#  * @return {void}
#  * @side_effect Writes to stdout.
#  */
log() {
  printf '[build] %s\n' "$*"
}

# /**
#  * @brief Aborts the build with a FAILED diagnostic naming the failed check.
#  * @details Writes `[build] FAILED: <message>` to stderr and exits 1; the EXIT trap then
#  * restores the previous `dist/` state (PKG-073). Complexity O(1).
#  * @param message {string} Diagnostic naming the missing prerequisite or failed step.
#  * @return {void} Never returns.
#  * @side_effect Terminates the process with exit code 1.
#  */
fail() {
  printf '[build] FAILED: %s\n' "$*" >&2
  exit 1
}

# /**
#  * @brief Verifies that a command is resolvable on PATH.
#  * @param name {string} Command name, e.g. `node`.
#  * @return {void} Returns when the command exists.
#  * @throws {exit 1} Via `fail` when the command is absent (PKG-067).
#  */
require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "required command not found on PATH: $1"
  fi
}

# /**
#  * @brief Verifies that every relative import target of one emitted ESM entry resolves.
#  * @details Runs an inline Node.js program (no repository file added, PKG-068) that scans the entry
#  * source for static `from "./x"`, side-effect `import "./x"`, and dynamic `import("./x")` specifiers
#  * beginning with `./` or `../`. Each specifier resolved against the entry directory MUST name an
#  * existing, non-empty regular file. Unresolved specifiers are printed by the program and echoed in the
#  * failure diagnostic. Complexity O(n) in source length plus one filesystem probe per specifier.
#  * @param entry {string} Emitted entry path, e.g. `dist/cli.js`.
#  * @return {void} Returns when every relative import target resolves.
#  * @throws {exit 1} Via `fail` naming the entry and the unresolved specifiers (PKG-069, PKG-074).
#  * @side_effect None; read-only inspection of the entry and its import targets.
#  */
verify_relative_imports() {
  local entry="$1"
  local program
  local unresolved=""
  program="$(cat <<'NODE_IMPORT_CHECK'
const { existsSync, readFileSync, statSync } = require("node:fs");
const { dirname, resolve } = require("node:path");
const entry = process.argv[1];
const pattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["'](\.{1,2}\/[^"']+)["']/g;
const unresolved = [];
for (const match of readFileSync(entry, "utf8").matchAll(pattern)) {
  const target = resolve(dirname(entry), match[1]);
  if (!existsSync(target) || !statSync(target).isFile() || statSync(target).size === 0) {
    unresolved.push(match[1]);
  }
}
if (unresolved.length > 0) {
  process.stdout.write(unresolved.join(" "));
  process.exit(1);
}
NODE_IMPORT_CHECK
)"
  if ! unresolved="$(node -e "$program" "$entry")"; then
    fail "unresolved relative import(s) in $entry: ${unresolved:-none reported}"
  fi
}

# /**
#  * @brief Classifies one dist-relative path as a generated build output.
#  * @details Pattern set `*.js`, `*.js.map`, `*.d.ts`, `*.d.ts.map`, `*.tgz`, `*.tsbuildinfo`,
#  * `*.tmp` (PKG-072). Matching is case-sensitive; pure, O(1).
#  * @param relative {string} Path relative to `dist/`.
#  * @return {number} 0 when generated; 1 when non-generated.
#  */
is_generated_output() {
  case "$1" in
    *.js | *.js.map | *.d.ts | *.d.ts.map | *.tgz | *.tsbuildinfo | *.tmp) return 0 ;;
    *) return 1 ;;
  esac
}

# /**
#  * @brief Copies the pre-run `dist/` directory into the private work directory.
#  * @details Sets PREVIOUS_STATE to `absent` when `dist/` does not exist, or to `snapshot` after
#  * a complete copy. A failed copy leaves PREVIOUS_STATE as `unknown`, so the trap never deletes
#  * a partially copied user directory (PKG-073).
#  * @return {void}
#  * @side_effect Creates `$WORKDIR/previous-dist` when `dist/` pre-exists.
#  * @throws {exit 1} Via `fail` when `dist` exists but is not a directory.
#  */
snapshot_previous_dist() {
  if [ -e "$DIST_DIR" ]; then
    if [ ! -d "$DIST_DIR" ]; then
      fail "$DIST_DIR exists but is not a directory"
    fi
    if ! cp -a "$DIST_DIR" "$WORKDIR/previous-dist"; then
      fail "could not snapshot pre-existing $DIST_DIR/"
    fi
    PREVIOUS_STATE="snapshot"
  else
    PREVIOUS_STATE="absent"
  fi
}

# /**
#  * @brief Restores `dist/` to its pre-run state.
#  * @details Removes `dist/`, then copies the snapshot back when one exists (PKG-073).
#  * Complexity O(size of dist).
#  * @return {number} 0 on success; 1 when removal or restoration fails.
#  * @side_effect Mutates `dist/` only.
#  */
restore_previous_dist() {
  if ! rm -rf "$DIST_DIR"; then
    return 1
  fi
  if [ "$PREVIOUS_STATE" = "snapshot" ]; then
    if ! cp -a "$WORKDIR/previous-dist" "$DIST_DIR"; then
      return 1
    fi
  fi
  return 0
}

# /**
#  * @brief EXIT trap: restores the previous state on failure and removes the work directory.
#  * @details Preserves the original exit status. Restore is attempted only when the snapshot
#  * state is known (PKG-073). The work directory is kept when a user snapshot could not be restored.
#  * Cleanup failure on a successful build turns the result into exit 1. Complexity O(size of dist)
#  * on the failure path.
#  * @return {void} Terminates with the resulting exit status.
#  * @side_effect Mutates `dist/` on failure; removes `$WORKDIR`.
#  */
on_exit() {
  local exit_status=$?
  trap - EXIT
  if [ "$exit_status" -ne 0 ] && [ "$PREVIOUS_STATE" != "unknown" ]; then
    # The snapshot is retained from the first destructive step until a complete restore (PKG-073).
    if [ "$PREVIOUS_STATE" = "snapshot" ]; then
      SNAPSHOT_RETAINED=1
    fi
    if restore_previous_dist; then
      SNAPSHOT_RETAINED=0
    else
      printf '[build] FAILED: could not restore the previous %s/ state (snapshot kept at %s)\n' "$DIST_DIR" "$WORKDIR" >&2
    fi
  fi
  if [ "$SNAPSHOT_RETAINED" -eq 0 ] && [ -n "$WORKDIR" ]; then
    if ! rm -rf "$WORKDIR"; then
      printf '[build] FAILED: could not remove temporary directory %s\n' "$WORKDIR" >&2
      if [ "$exit_status" -eq 0 ]; then
        exit_status=1
      fi
    fi
  fi
  exit "$exit_status"
}

# /**
#  * @brief Restores every non-generated snapshot entry missing from the freshly built `dist/`.
#  * @details Enumerates all snapshot entries (NUL-delimited list, no pipeline status masking).
#  * Skips only regular files matching generated patterns (PKG-072); recreates directories, copies
#  * symlinks and other non-generated entries, and aborts on destination-type collisions so the
#  * EXIT trap restores the original snapshot rather than discarding user content (PKG-071, PKG-073).
#  * Complexity O(n) in snapshot entry count.
#  * @return {void}
#  * @side_effect Creates files and directories under `dist/`.
#  * @throws {exit 1} Via `fail` when enumeration or copy fails.
#  */
preserve_non_generated_entries() {
  local snapshot_root="$WORKDIR/previous-dist"
  local file_list="$WORKDIR/previous-files.lst"
  local source
  local relative
  local destination
  if [ "$PREVIOUS_STATE" != "snapshot" ]; then
    return 0
  fi
  if ! find "$snapshot_root" -mindepth 1 -print0 >"$file_list"; then
    fail "could not enumerate the previous $DIST_DIR/ snapshot"
  fi
  while IFS= read -r -d '' source; do
    relative="${source#"$snapshot_root"/}"
    destination="$DIST_DIR/$relative"
    if [ -f "$source" ] && [ ! -L "$source" ] && is_generated_output "$relative"; then
      continue
    fi
    if [ -d "$source" ] && [ ! -L "$source" ]; then
      if [ -L "$destination" ] || { [ -e "$destination" ] && [ ! -d "$destination" ]; }; then
        fail "non-generated directory conflicts with build output: $destination"
      fi
      if [ ! -d "$destination" ] && ! mkdir -p "$destination"; then
        fail "could not preserve non-generated directory $destination"
      fi
      log "preserved non-generated directory: $destination"
      continue
    fi
    if [ -e "$destination" ] || [ -L "$destination" ]; then
      fail "non-generated entry conflicts with build output: $destination"
    fi
    if ! mkdir -p "$(dirname "$destination")" || ! cp -a "$source" "$destination"; then
      fail "could not preserve non-generated entry $destination"
    fi
    log "preserved non-generated entry: $destination"
  done <"$file_list"
}

trap on_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

# Preflight (PKG-067, PKG-068).
require_command node
require_command npm
require_command tar
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt "$MIN_NODE_MAJOR" ]; then
  fail "Node.js >= $MIN_NODE_MAJOR required, found major $NODE_MAJOR"
fi
if [ ! -x "node_modules/.bin/tsup" ]; then
  fail "dependencies not installed: node_modules/.bin/tsup missing; install dependencies with 'npm ci' first"
fi

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/mcp-google-api-build.XXXXXX")"
snapshot_previous_dist
log "preflight passed (node $(node -p 'process.versions.node'), dist/ state: $PREVIOUS_STATE)"

# Compile (PKG-069).
log "compile: npm run build"
npm run build

for artifact in cli.js index.js cli.d.ts index.d.ts; do
  if [ ! -s "$DIST_DIR/$artifact" ]; then
    fail "compile output missing or empty: $DIST_DIR/$artifact"
  fi
done
node --check "$DIST_DIR/cli.js"
node --check "$DIST_DIR/index.js"
verify_relative_imports "$DIST_DIR/cli.js"
verify_relative_imports "$DIST_DIR/index.js"
log "compile verified: $DIST_DIR/cli.js, $DIST_DIR/index.js, declaration files present, relative imports resolved"

# Preservation of non-generated dist/ entries (PKG-071, PKG-072).
preserve_non_generated_entries

# Pack (PKG-069, PKG-070).
rm -f -- "$DIST_DIR"/*.tgz
log "pack: npm pack --ignore-scripts --pack-destination $DIST_DIR"
PACK_JSON="$(npm pack --ignore-scripts --json --pack-destination "$DIST_DIR")"
TARBALL_NAME="$(printf '%s' "$PACK_JSON" | node -e 'let raw = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", (chunk) => { raw += chunk; }); process.stdin.on("end", () => { const entries = JSON.parse(raw); if (!Array.isArray(entries) || typeof entries[0]?.filename !== "string") { process.exit(1); } process.stdout.write(entries[0].filename); });')"
EXPECTED_TARBALL="$(node -p 'const pkg = require("./package.json"); pkg.name + "-" + pkg.version + ".tgz";')"
if [ "$TARBALL_NAME" != "$EXPECTED_TARBALL" ]; then
  fail "tarball name mismatch: npm produced '$TARBALL_NAME', expected '$EXPECTED_TARBALL'"
fi
if [ ! -s "$DIST_DIR/$TARBALL_NAME" ]; then
  fail "tarball missing or empty: $DIST_DIR/$TARBALL_NAME"
fi
if ! tar -tzf "$DIST_DIR/$TARBALL_NAME" >/dev/null; then
  fail "tarball not readable by tar: $DIST_DIR/$TARBALL_NAME"
fi

# Summary (PKG-074).
log "SUCCESS: release artifacts generated in $DIST_DIR/:"
find "$DIST_DIR" -type f -print0 | sort -z | while IFS= read -r -d '' artifact; do
  printf '[build]   %s (%s bytes)\n' "$artifact" "$(wc -c <"$artifact")"
done
exit 0
