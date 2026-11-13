#!/usr/bin/env bash
# /**
#  * @file mcp-google-api.sh
#  * @brief Launches the local repository copy exactly like the installed mcp-google-api distribution bin.
#  * @details Rebuilds the runtime bundle from the current repository sources on every invocation
#  * (PRJ-019) into a private temporary build directory outside the repository working tree, so the
#  * repository `dist/` directory — including the committed release tarball — is never created,
#  * modified, or deleted (PRJ-025, PRJ-026, PKG-062, PKG-123, PKG-124). Order:
#  * 1. Preflight (PRJ-024): `node` on PATH and the linked compiler binary
#  *    `node_modules/.bin/tsup`; a missing prerequisite aborts non-zero before any build step.
#  * 2. Temporary build (PRJ-019): `node_modules/.bin/tsup --out-dir <private temp directory>` with
#  *    the repository `tsup.config.ts`, compile diagnostics routed to stderr so stdout stays
#  *    reserved for the CLI (CTN-003). The private temporary directory links the repository
#  *    `node_modules` tree beside the compiler output directory so the emitted bundle resolves its
#  *    external runtime dependencies without copying or installing anything, while the compiler
#  *    output cleanup can never reach the linked repository files; an ESM `package.json` marker is
#  *    written after the compile, because the compiler cleans its output directory.
#  * 3. Artifact verification (PRJ-019): the emitted `cli.js` entry MUST exist, be non-empty, and
#  *    pass `node --check`; otherwise the launcher aborts non-zero.
#  * 4. Launch (PRJ-022): `node <temp>/cli.js "$@"` forwards every argument unchanged and the
#  *    child exit code becomes the script exit code.
#  * 5. Cleanup (PRJ-027, PRJ-028): the EXIT trap removes the private temporary build directory on
#  *    success and on failure while preserving the original exit status; the repository working
#  *    tree and index stay byte-identical. Signals HUP, INT, and TERM exit through the same trap
#  *    with status 129, 130, and 143.
#  * Dependency installation stays an explicit manual step: run `npm ci` once before the first
#  * invocation; this script never installs dependencies (PKG-019).
#  * @return Exit code of the launched CLI; non-zero when a preflight, build, or verification step fails.
#  * @pre Repository dependencies installed via `npm ci`.
#  * @post No repository artifact was created or modified and the private temporary build directory
#  *       is removed.
#  * @note Writes only under the OS temporary directory; no network access, no dependency
#  *       installation, and no package publication.
#  * @satisfies PRJ-018, PRJ-019, PRJ-022, PRJ-024, PRJ-025, PRJ-026, PRJ-027, PRJ-028
#  */
set -euo pipefail
cd "$(dirname "$0")/.."

# Absolute repository root; the dependency tree is linked, never copied, into the temp build (PRJ-019).
readonly REPO_ROOT="$PWD"
# Linked compiler binary rebuilding the runtime bundle outside the repository (PRJ-019, PRJ-024).
readonly COMPILER_BIN="node_modules/.bin/tsup"
# Emitted runtime entry inside the private temporary build directory (PRJ-019, PRJ-022).
readonly RUNTIME_BUNDLE="cli.js"
# Private temporary build directory; empty until preflight succeeds (PRJ-027).
WORKDIR=""

# /**
#  * @brief Aborts the launcher with a tagged diagnostic on stderr.
#  * @details Prints `[mcp-google-api] FAILED: <message>` and exits non-zero; the EXIT trap then
#  * removes the private temporary build directory (PRJ-024, PRJ-027).
#  * @param message {string} Diagnostic naming the missing prerequisite or the failed step.
#  * @return {void} Never returns.
#  * @side_effect Terminates the process with exit code 1.
#  */
fail() {
  printf '[mcp-google-api] FAILED: %s\n' "$*" >&2
  exit 1
}

# /**
#  * @brief EXIT trap removing the private temporary build directory.
#  * @details Runs on success and on failure, never overrides a non-zero status, and turns a cleanup
#  * failure of a successful run into exit code 1 so no temporary artifact survives (PRJ-027,
#  * PRJ-028). Complexity O(size of the temporary build directory).
#  * @return {void} Terminates with the resulting exit status.
#  * @side_effect Removes `$WORKDIR` when it exists.
#  */
on_exit() {
  local exit_status=$?
  trap - EXIT
  if [ -n "$WORKDIR" ] && [ -d "$WORKDIR" ]; then
    if ! rm -rf "$WORKDIR"; then
      printf '[mcp-google-api] FAILED: cleanup: could not remove temporary build directory %s\n' "$WORKDIR" >&2
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

# Preflight (PRJ-024): never builds without the linked compiler toolchain.
if ! command -v node >/dev/null 2>&1; then
  fail "required command not found on PATH: node"
fi
if [ ! -x "$COMPILER_BIN" ]; then
  fail "dependencies not installed: $COMPILER_BIN missing; run 'npm ci' before launching the local copy"
fi

# Private temporary build directory outside the repository working tree (PRJ-019, PRJ-025).
if ! WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/mcp-google-api-run.XXXXXX")"; then
  fail "could not create the private temporary build directory"
fi
BUILD_DIR="$WORKDIR/build"
# The emitted bundle resolves its external runtime dependencies through the repository dependency
# tree, so the private temporary directory links it instead of copying or installing anything. The
# link lives beside the compiler output directory, never inside it: the compiler cleans its output
# directory recursively, so a link below `$BUILD_DIR` would let the cleanup reach repository files.
if ! ln -s "$REPO_ROOT/node_modules" "$WORKDIR/node_modules"; then
  fail "could not link the repository dependency tree into the temporary directory: $WORKDIR/node_modules"
fi
if ! mkdir -p "$BUILD_DIR"; then
  fail "could not create the temporary build directory: $BUILD_DIR"
fi

# Temporary build from the current repository sources (PRJ-019); compile output on stderr (CTN-003).
if ! "$COMPILER_BIN" --out-dir "$BUILD_DIR" >&2; then
  fail "runtime bundle compilation failed: $COMPILER_BIN --out-dir $BUILD_DIR"
fi
if ! printf '{\n  "type": "module"\n}\n' >"$BUILD_DIR/package.json"; then
  fail "could not write the module marker into the temporary build directory: $BUILD_DIR"
fi

# Artifact verification (PRJ-019): the launch entry must exist, be non-empty, and parse.
ENTRY_PATH="$BUILD_DIR/$RUNTIME_BUNDLE"
if [ ! -s "$ENTRY_PATH" ]; then
  fail "compiled runtime entry missing or empty: $ENTRY_PATH"
fi
if ! node --check "$ENTRY_PATH" >&2; then
  fail "compiled runtime entry failed node --check: $ENTRY_PATH"
fi

# Launch (PRJ-022): forward every argument unchanged and propagate the child exit code.
set +e
node "$ENTRY_PATH" "$@"
LAUNCH_STATUS=$?
set -e
exit "$LAUNCH_STATUS"
