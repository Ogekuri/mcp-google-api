#!/usr/bin/env bash
# /**
#  * @file build.sh
#  * @brief Generates the single ESM runtime bundle in `dist/` after cleaning every earlier build.
#  * @details Standalone, repeatable runtime-bundle generator and obsolete-build cleaner (PKG-065,
#  * PKG-104), runnable from any working directory (PKG-066), in fail-fast order:
#  * 1. Preflight (PKG-067, PKG-068): `node` and `npm` on PATH, Node.js major >= 24, and the
#  *    installed `node_modules/.bin/tsup` binary. Dependencies are never installed here and no
#  *    package is ever published.
#  * 2. Obsolete-build cleanup (PKG-071, PKG-072, PKG-104, PKG-105, PKG-106, PKG-107): every
#  *    `dist/` regular file classified as generated (`*.js`, `*.js.map`, `*.d.ts`, `*.d.ts.map`,
#  *    `*.tgz`, `*.tsbuildinfo`, `*.tmp`) is removed, covering every artifact of every earlier
#  *    build; emptied ancestor directories are pruned deepest-first, `dist/` itself only when
#  *    empty, and non-generated entries are never touched. An absent `dist/` is a no-op.
#  * 3. Compile (PKG-069, PKG-129): `npm run build` invokes the `tsup` compiler directly for the
#  *    single runtime entry `src/cli.ts`; `tsup.config.ts` keeps `clean: true`, so the compiler
#  *    also removes stale generated outputs before compiling (PKG-130).
#  * 4. Compile verification (PKG-069, PKG-074, PKG-109): `dist/cli.js` MUST exist, be non-empty,
#  *    pass `node --check`, and every relative import target MUST resolve; `dist/` MUST hold no
#  *    other file besides `dist/cli.js`.
#  * 5. Final cleanup and summary (PKG-102, PKG-108, PKG-109, PKG-074): every `*.tsbuildinfo` and
#  *    `*.tmp` file is removed, the private work directory is removed, and the path plus byte size
#  *    of every artifact in `dist/` is printed. No `*.tgz` archive is ever created (PKG-102).
#  * Failure semantics (PKG-073): any failing phase prints `[build] FAILED: <phase>: <reason>` on
#  * stderr and exits non-zero. Signals HUP, INT, and TERM exit through the EXIT trap with status
#  * 129, 130, and 143.
#  * @return Exit code 0 when the bundle is generated and verified; non-zero otherwise.
#  * @pre Dependencies installed beforehand by the project package manager.
#  * @post On success `dist/` holds exactly the verified `dist/cli.js` bundle and the private work
#  *       directory is removed; on failure the failing phase is named on stderr.
#  * @note Writes only under `dist/` and the OS temp directory; no network access, no dependency
#  *       installation, no publication.
#  * @satisfies PKG-065, PKG-066, PKG-067, PKG-068, PKG-069, PKG-071, PKG-072, PKG-073, PKG-074,
#  *            PKG-102, PKG-104, PKG-105, PKG-106, PKG-107, PKG-108, PKG-109, PKG-129, PKG-130
#  */
set -euo pipefail
cd "$(dirname "$0")/.."

readonly DIST_DIR="dist"
readonly RUNTIME_BUNDLE="cli.js"
readonly MIN_NODE_MAJOR=24

# Phase label of the step in progress; reported on failure (PKG-073).
CURRENT_PHASE="preflight"
# Private work directory holding enumeration lists only; removed on exit (PKG-108).
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
#  * @brief Aborts the build naming the current phase and the failed check.
#  * @details Writes `[build] FAILED: <phase>: <message>` to stderr and exits non-zero (PKG-073);
#  * the EXIT trap then removes the private work directory. Complexity O(1).
#  * @param message {string} Diagnostic naming the missing prerequisite or failed step.
#  * @return {void} Never returns.
#  * @side_effect Terminates the process with exit code 1.
#  */
fail() {
  printf '[build] FAILED: %s: %s\n' "$CURRENT_PHASE" "$*" >&2
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
#  * @brief Classifies one dist-relative path as an intermediate build artifact.
#  * @details Intermediate subset of the PKG-072 generated set: `*.tsbuildinfo` and `*.tmp`. No
#  * `*.tgz` class exists because the release pipeline packs the tarball in CI (PKG-102, PKG-111).
#  * Pure, O(1).
#  * @param relative {string} Path relative to `dist/`.
#  * @return {number} 0 when intermediate; 1 otherwise.
#  */
is_intermediate_output() {
  case "$1" in
    *.tsbuildinfo | *.tmp) return 0 ;;
    *) return 1 ;;
  esac
}

# /**
#  * @brief Removes one directory when it is empty, tolerating non-empty directories.
#  * @details `rmdir` succeeds only on an empty directory; a directory still holding any entry is
#  * preserved by design because it carries non-generated content (PKG-106). A directory that is
#  * still empty after a failed `rmdir` reports a real removal error (PKG-107).
#  * @param dir {string} Candidate ancestor of a removed artifact, or `dist/` itself.
#  * @return {void}
#  * @throws {exit 1} Via `fail` when the directory is empty yet cannot be removed.
#  * @side_effect Removes `dir` when empty.
#  */
prune_emptied_dir() {
  local dir="$1"
  if [ ! -d "$dir" ]; then
    return 0
  fi
  if rmdir -- "$dir" 2>/dev/null; then
    log "pruned emptied directory: $dir"
    return 0
  fi
  if [ -z "$(ls -A "$dir")" ]; then
    fail "could not remove emptied directory: $dir"
  fi
  return 0
}

# /**
#  * @brief Removes every `dist/` file accepted by the given classifier and prunes emptied ancestors.
#  * @details Enumerates every `dist/` regular file into a NUL-delimited list inside the private work
#  * directory, removes each file accepted by `$1`, then prunes emptied ancestor directories
#  * deepest-first and `dist/` itself when it ends up empty (PKG-106). Symlinks, directories, and
#  * non-accepted entries are preserved. An absent `dist/` is a no-op; enumeration or removal
#  * failures abort naming the failed entry (PKG-107). Complexity O(n) in `dist/` entry count.
#  * @param classifier {string} Name of the classifier function (`is_generated_output` or `is_intermediate_output`).
#  * @param list_name {string} Base name of the private enumeration list file.
#  * @param label {string} Phase label used in log lines.
#  * @return {void}
#  * @throws {exit 1} Via `fail` when enumeration or removal fails.
#  * @side_effect Removes accepted files and emptied directories under `dist/` only.
#  */
remove_classified_outputs() {
  local classifier="$1"
  local list_name="$2"
  local label="$3"
  if [ ! -e "$DIST_DIR" ]; then
    log "$label: nothing to remove, $DIST_DIR/ is absent"
    return 0
  fi
  if [ ! -d "$DIST_DIR" ]; then
    fail "$DIST_DIR exists but is not a directory"
  fi
  local file_list="$WORKDIR/$list_name"
  if ! find "$DIST_DIR" -type f -print0 >"$file_list"; then
    fail "could not enumerate $DIST_DIR/ during the $label phase"
  fi
  local path
  local relative
  local parent
  local removed=0
  local removed_dirs=()
  while IFS= read -r -d '' path; do
    relative="${path#"$DIST_DIR"/}"
    if ! "$classifier" "$relative"; then
      continue
    fi
    if ! rm -f -- "$path"; then
      fail "could not remove build artifact: $path"
    fi
    log "removed $label artifact: $path"
    removed=$((removed + 1))
    parent="$(dirname -- "$path")"
    while [ "$parent" != "$DIST_DIR" ] && [ "$parent" != "." ]; do
      removed_dirs+=("$parent")
      parent="$(dirname -- "$parent")"
    done
  done <"$file_list"
  if [ "${#removed_dirs[@]}" -gt 0 ]; then
    while IFS= read -r -d '' parent; do
      prune_emptied_dir "$parent"
    done < <(printf '%s\0' "${removed_dirs[@]}" | sort -rz | uniq -z)
  fi
  prune_emptied_dir "$DIST_DIR"
  log "$label: removed $removed artifact(s) from $DIST_DIR/"
}

# /**
#  * @brief Verifies that every relative import target of one emitted ESM entry resolves.
#  * @details Runs an inline Node.js program (no repository file added, PKG-068) that scans the entry
#  * source for static `from "./x"`, side-effect `import "./x"`, and dynamic `import("./x")`
#  * specifiers beginning with `./` or `../`. Each specifier resolved against the entry directory
#  * MUST name an existing, non-empty regular file; unresolved specifiers are reported and echoed in
#  * the failure diagnostic. Complexity O(n) in source length plus one filesystem probe per
#  * specifier.
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
#  * @brief Removes the private work directory and proves it is gone.
#  * @details Runs only after every artifact was generated and verified (PKG-108). A failed removal
#  * or a surviving path aborts the build (PKG-109). Complexity O(size of the work directory).
#  * @return {void}
#  * @throws {exit 1} Via `fail` when the directory cannot be removed or still exists.
#  * @side_effect Removes `$WORKDIR`; clears the handle so the EXIT trap skips it.
#  */
remove_workdir() {
  if [ -z "$WORKDIR" ]; then
    return 0
  fi
  if ! rm -rf "$WORKDIR"; then
    fail "could not remove temporary work directory $WORKDIR"
  fi
  if [ -e "$WORKDIR" ]; then
    fail "temporary work directory survives the final cleanup: $WORKDIR"
  fi
  WORKDIR=""
  log "final cleanup: temporary work directory removed"
}

# /**
#  * @brief EXIT trap: removes the private work directory and preserves the exit status.
#  * @details Never overrides a non-zero status (PKG-073); a cleanup failure on a successful run
#  * turns the result into exit 1 (PKG-108, PKG-109). Complexity O(size of the work directory).
#  * @return {void} Terminates with the resulting exit status.
#  * @side_effect Removes `$WORKDIR`.
#  */
on_exit() {
  local exit_status=$?
  trap - EXIT
  if [ -n "$WORKDIR" ] && [ -d "$WORKDIR" ]; then
    if ! rm -rf "$WORKDIR"; then
      printf '[build] FAILED: cleanup: could not remove temporary work directory %s\n' "$WORKDIR" >&2
      if [ "$exit_status" -eq 0 ]; then
        exit_status=1
      fi
    fi
  fi
  exit "$exit_status"
}

trap on_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

# Preflight (PKG-067, PKG-068).
CURRENT_PHASE="preflight"
require_command node
require_command npm
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt "$MIN_NODE_MAJOR" ]; then
  fail "Node.js >= $MIN_NODE_MAJOR required, found major $NODE_MAJOR"
fi
if [ ! -x "node_modules/.bin/tsup" ]; then
  fail "dependencies not installed: node_modules/.bin/tsup missing; run 'npm run build' only after installing dependencies"
fi
if ! WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/mcp-google-api-build.XXXXXX")"; then
  fail "could not create the private work directory"
fi
log "preflight passed (node $(node -p 'process.versions.node'))"

# Obsolete-build cleanup (PKG-071, PKG-072, PKG-104, PKG-105, PKG-106, PKG-107).
CURRENT_PHASE="cleanup"
remove_classified_outputs is_generated_output "obsolete-files.lst" "cleanup"

# Compile (PKG-069, PKG-129, PKG-130).
CURRENT_PHASE="compile"
log "compile: npm run build"
if ! npm run build; then
  fail "npm run build exited non-zero"
fi

# Compile verification (PKG-069, PKG-074).
CURRENT_PHASE="verification"
if [ ! -s "$DIST_DIR/$RUNTIME_BUNDLE" ]; then
  fail "compile output missing or empty: $DIST_DIR/$RUNTIME_BUNDLE"
fi
node --check "$DIST_DIR/$RUNTIME_BUNDLE"
verify_relative_imports "$DIST_DIR/$RUNTIME_BUNDLE"
log "compile verified: $DIST_DIR/$RUNTIME_BUNDLE with relative imports resolved"

# Final cleanup (PKG-102, PKG-108, PKG-109): no tarball, no intermediate artifact, no work directory.
CURRENT_PHASE="final cleanup"
remove_classified_outputs is_intermediate_output "intermediate-files.lst" "final cleanup"
if [ -e "$DIST_DIR" ]; then
  unexpected=""
  while IFS= read -r -d '' path; do
    relative="${path#"$DIST_DIR"/}"
    if [ "$relative" = "$RUNTIME_BUNDLE" ]; then
      continue
    fi
    if is_generated_output "$relative"; then
      unexpected="$unexpected $path"
    fi
  done < <(find "$DIST_DIR" -type f -print0)
  if [ -n "$unexpected" ]; then
    fail "unexpected generated artifact(s) in $DIST_DIR/:$unexpected"
  fi
fi
remove_workdir
log "repository left clean: no intermediate build artifact, no temporary work directory"

# Summary (PKG-074).
CURRENT_PHASE="summary"
log "SUCCESS: runtime bundle generated in $DIST_DIR/:"
find "$DIST_DIR" -type f -print0 | sort -z | while IFS= read -r -d '' artifact; do
  printf '[build]   %s (%s bytes)\n' "$artifact" "$(wc -c <"$artifact")"
done
exit 0
