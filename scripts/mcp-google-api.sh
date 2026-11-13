#!/usr/bin/env bash
# /**
#  * @file mcp-google-api.sh
#  * @brief Launches the local repository copy exactly like the installed mcp-google-api distribution bin.
#  * @details Resolves the runtime bundle from the first available source on every invocation, into a
#  * private temporary build directory outside the repository working tree, so the repository `dist/`
#  * directory is never created, modified, or deleted (PRJ-025) and every `dist/` entry other than the
#  * committed release tarball is ignored (PRJ-026). Ordered bundle sources:
#  * 1. Compiler-preferred rebuild (PRJ-019): when `node_modules/.bin/tsup` is executable, the bundle
#  *    is rebuilt from the current repository sources with
#  *    `node_modules/.bin/tsup --out-dir <private temp directory>` and the repository
#  *    `tsup.config.ts`; the temporary directory links the repository `node_modules` tree beside the
#  *    compiler output directory so the emitted bundle resolves external runtime dependencies
#  *    without copying or installing anything, while the compiler cleanup can never reach linked
#  *    repository files.
#  * 2. Release-artifact fallback (PRJ-029): when the compiler is not executable, the single
#  *    `package/dist/cli.js` member of the committed `dist/<package name>-<version>.tgz` release
#  *    artifact is extracted into the same private temporary directory. Whenever the repository
#  *    dependency tree exists, the temporary directory links it beside the compiler output directory
#  *    so both bundle sources resolve their external runtime dependencies without copying or
#  *    installing anything, while the compiler cleanup can never reach linked repository files.
#  * 3. Dual-source abort (PRJ-024): when neither source is available, the launcher aborts non-zero
#  *    naming both missing bundle sources and the manual remediation commands.
#  * An ESM `package.json` marker is written after source resolution because the compiler cleans its
#  * output directory. Compiler and extraction diagnostics are routed to stderr so stdout stays
#  * reserved for the CLI (CTN-003). The emitted `cli.js` entry MUST exist, be non-empty, and pass
#  * `node --check`. `node <temp>/cli.js "$@"` forwards every argument unchanged and the child exit
#  * code becomes the script exit code (PRJ-022). The EXIT trap removes the private temporary build
#  * directory on success and on failure while preserving the original exit status (PRJ-027) and the
#  * repository working tree and index stay byte-identical (PRJ-028); signals HUP, INT, and TERM exit
#  * through the same trap with status 129, 130, and 143.
#  * Dependency installation stays an explicit manual step: run `npm ci` once to link the compiler;
#  * this script never installs dependencies (PKG-019).
#  * @return Exit code of the launched CLI; non-zero when no bundle source resolves or verification fails.
#  * @pre `node` is available and the checkout holds either `node_modules/.bin/tsup` or the committed release tarball.
#  * @post No repository artifact was created or modified and the private temporary build directory
#  *       is removed.
#  * @note Writes only under the OS temporary directory and reads at most the committed release
#  *       tarball; no network access, no dependency installation, and no package publication.
#  * @satisfies PRJ-018, PRJ-019, PRJ-022, PRJ-024, PRJ-025, PRJ-026, PRJ-027, PRJ-028, PRJ-029
#  */
set -euo pipefail
cd "$(dirname "$0")/.."

# Absolute repository root; the dependency tree is linked, never copied, into the temp build (PRJ-019).
readonly REPO_ROOT="$PWD"
# Linked compiler binary rebuilding the runtime bundle outside the repository (PRJ-019).
readonly COMPILER_BIN="node_modules/.bin/tsup"
# Emitted runtime entry inside the private temporary build directory (PRJ-019, PRJ-022, PRJ-029).
readonly RUNTIME_BUNDLE="cli.js"
# Member path of the runtime bundle inside every packed release tarball (PRJ-029).
readonly PACKED_BUNDLE_MEMBER="package/dist/cli.js"
# Private temporary build directory; empty until a bundle source resolves (PRJ-027).
WORKDIR=""
# Package identity read from `package.json`; drives the committed release tarball name (PRJ-029).
PACKAGE_NAME=""
PACKAGE_VERSION=""
# Committed release tarball path of the current package version (PRJ-026, PRJ-029).
RELEASE_TARBALL=""

# /**
#  * @brief Aborts the launcher with a tagged diagnostic on stderr.
#  * @details Prints `[mcp-google-api] FAILED: <message>` and exits non-zero; the EXIT trap then
#  * removes the private temporary build directory (PRJ-024, PRJ-027).
#  * @param message {string} Diagnostic naming missing bundle sources, remediation, or the failed step.
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

# Preflight: `node` executes the resolved bundle (PRJ-022) and reads the package identity (PRJ-029).
if ! command -v node >/dev/null 2>&1; then
  fail "required command not found on PATH: node"
fi
if ! PACKAGE_NAME="$(node -p 'require("./package.json").name')"; then
  fail "could not read the name field from package.json"
fi
if [ -z "$PACKAGE_NAME" ]; then
  fail "package.json carries an empty name field"
fi
if ! PACKAGE_VERSION="$(node -p 'require("./package.json").version')"; then
  fail "could not read the version field from package.json"
fi
if [ -z "$PACKAGE_VERSION" ]; then
  fail "package.json carries an empty version field"
fi
RELEASE_TARBALL="dist/$PACKAGE_NAME-$PACKAGE_VERSION.tgz"

# Ordered bundle-source resolution (PRJ-019, PRJ-024, PRJ-029): the linked compiler is preferred,
# the committed release artifact is the fallback, and only a launcher with neither source aborts.
if [ -x "$COMPILER_BIN" ]; then
  BUNDLE_SOURCE="compiler"
elif [ -f "$RELEASE_TARBALL" ]; then
  BUNDLE_SOURCE="release-tarball"
else
  fail "no runtime bundle source available: $COMPILER_BIN is not executable and $RELEASE_TARBALL is absent; run 'npm ci' to link the compiler or 'npm run build' to regenerate the release artifact"
fi

# Private temporary build directory outside the repository working tree (PRJ-019, PRJ-025).
if ! WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/mcp-google-api-run.XXXXXX")"; then
  fail "could not create the private temporary build directory"
fi
BUILD_DIR="$WORKDIR/build"
if ! mkdir -p "$BUILD_DIR"; then
  fail "could not create the temporary build directory: $BUILD_DIR"
fi
ENTRY_PATH="$BUILD_DIR/$RUNTIME_BUNDLE"

# External runtime dependencies resolve through the repository dependency tree when it exists; the
# link lives beside the compiler output directory, never inside it: the compiler cleans its output
# directory recursively, so a link below `$BUILD_DIR` would let the cleanup reach repository files.
if [ -d "$REPO_ROOT/node_modules" ]; then
  if ! ln -s "$REPO_ROOT/node_modules" "$WORKDIR/node_modules"; then
    fail "could not link the repository dependency tree into the temporary directory: $WORKDIR/node_modules"
  fi
fi

if [ "$BUNDLE_SOURCE" = "compiler" ]; then
  # Temporary rebuild from the current repository sources (PRJ-019); diagnostics on stderr (CTN-003).
  if ! "$COMPILER_BIN" --out-dir "$BUILD_DIR" >&2; then
    fail "runtime bundle compilation failed: $COMPILER_BIN --out-dir $BUILD_DIR"
  fi
else
  # Committed release artifact is read-only input; only the private temporary directory is written
  # (PRJ-025, PRJ-026, PRJ-029).
  if ! tar -xzOf "$RELEASE_TARBALL" "$PACKED_BUNDLE_MEMBER" >"$ENTRY_PATH" 2>/dev/null; then
    fail "could not extract $PACKED_BUNDLE_MEMBER from the committed release artifact: $RELEASE_TARBALL"
  fi
fi

# ESM marker written after source resolution because the compiler cleans its output directory.
if ! printf '{\n  "type": "module"\n}\n' >"$BUILD_DIR/package.json"; then
  fail "could not write the module marker into the temporary build directory: $BUILD_DIR"
fi

# Artifact verification (PRJ-019, PRJ-029): the launch entry must exist, be non-empty, and parse.
if [ ! -s "$ENTRY_PATH" ]; then
  fail "runtime entry missing or empty from bundle source '$BUNDLE_SOURCE': $ENTRY_PATH"
fi
if ! node --check "$ENTRY_PATH" >&2; then
  fail "runtime entry failed node --check from bundle source '$BUNDLE_SOURCE': $ENTRY_PATH"
fi

# Launch (PRJ-022): forward every argument unchanged and propagate the child exit code.
set +e
node "$ENTRY_PATH" "$@"
LAUNCH_STATUS=$?
set -e
exit "$LAUNCH_STATUS"
