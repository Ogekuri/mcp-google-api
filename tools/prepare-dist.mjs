#!/usr/bin/env node
/**
 * @file prepare-dist.mjs
 * @brief Materializes the packaged `dist/cli.js` runtime bundle for source installs without a compiler toolchain.
 * @details npm executes the root `prepare` lifecycle of a git-dependency checkout before
 *          `node_modules/.bin` links are available, so a compiler-backed prepare aborts the
 *          develop-channel install (`npm install -g github:Ogekuri/mcp-google-api#<tag>`, REQ-171)
 *          with `sh: 1: tsup: not found` (exit 127) even though devDependencies resolve.
 *          Resolution order: (1) an existing non-empty `dist/cli.js` is a no-op, so the
 *          `prepublishOnly` build result of `npm publish` never regresses (PKG-005);
 *          (2) the committed current-version release tarball `dist/<name>-<version>.tgz`
 *          present in the checkout is unpacked to `dist/cli.js` (PKG-091, PKG-113), keeping
 *          the release artifact authoritative and leaving the tracked tarball untouched;
 *          (3) a linked `node_modules/.bin/tsup` runs the `build` lifecycle, preserving
 *          source builds for commits without a release tarball;
 *          (4) otherwise the script aborts non-zero with build remediation (PRJ-021).
 * @satisfies PKG-005, PKG-019, PKG-091, PKG-113, PRJ-020, PRJ-021, REQ-171
 * @note Fallback paths install no dependency, contact no registry, and compile nothing.
 *       Only `dist/cli.js` is written; every other generated `dist/` output stays absent
 *       (PKG-090). Diagnostics go to stderr as `[prepare-dist]` lines.
 * @see package.json `scripts.prepare`
 * @see tools/check-release-artifacts.mjs
 * @pre `package.json` exists at the repository root resolved from this script location.
 * @post On success `dist/cli.js` is a non-empty file usable by the installed bin (PRJ-020).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root resolved from this script location (cwd-independent). */
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Repository-relative runtime bundle emitted by the release build and executed by the bin (PRJ-020). */
const RUNTIME_BUNDLE_RELATIVE_PATH = join("dist", "cli.js");

/** Directory holding generated outputs and the committed release tarball (PKG-090, PKG-091). */
const DIST_DIRECTORY_RELATIVE_PATH = "dist";

/** Member path of the shipped runtime bundle inside every npm-packed release tarball (PKG-075). */
const PACKED_BUNDLE_MEMBER = "package/dist/cli.js";

/** Platform-specific tsup launcher linked by npm while a compiler toolchain is installed. */
const COMPILER_RELATIVE_PATH = join("node_modules", ".bin", process.platform === "win32" ? "tsup.cmd" : "tsup");

/** npm launcher used for the source-build path (Windows resolves the `.cmd` shim). */
const NPM_EXECUTABLE = process.platform === "win32" ? "npm.cmd" : "npm";

/** Upper bound for captured `tar` stdout in bytes. */
const TAR_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

/**
 * @brief Emits one tagged diagnostic on stderr.
 * @details stdout stays empty so npm lifecycle output remains unpolluted.
 * @param message {string} Diagnostic text.
 * @return {void}
 * @note Complexity O(n) in message length.
 */
function log(message) {
  console.error(`[prepare-dist] ${message}`);
}

/**
 * @brief Tests whether a path is an existing non-empty regular file.
 * @details Follows symbolic links because npm links compiler binaries through `.bin` shims.
 * @param path {string} Absolute or relative candidate path.
 * @return {boolean} True when the path is a non-empty file; false when absent, empty, or a directory.
 * @note Complexity O(1); no side effects.
 */
function isNonEmptyFile(path) {
  try {
    const stats = statSync(path);
    return stats.isFile() && stats.size > 0;
  } catch {
    return false;
  }
}

/**
 * @brief Reads the package name and version of the repository manifest.
 * @details The version selects the committed release tarball basename (PKG-091, PKG-137).
 * @return {{ name: string, version: string }} Package identity used for the tarball path.
 * @throws {Error} When `package.json` is unreadable or not valid JSON.
 * @note Complexity O(file size).
 */
function readPackageIdentity() {
  const manifest = JSON.parse(readFileSync(join(PROJECT_ROOT, "package.json"), "utf8"));
  return { name: String(manifest.name), version: String(manifest.version) };
}

/**
 * @brief Runs `tar` synchronously and returns its captured stdout.
 * @details Buffer encoding preserves the binary member content.
 * @param args {string[]} Arguments forwarded verbatim to `tar`.
 * @return {Buffer} Captured stdout bytes.
 * @throws {Error} When `tar` cannot be spawned or exits non-zero, carrying the captured stderr.
 * @note Complexity O(output size).
 */
function runTar(args) {
  const result = spawnSync("tar", args, { maxBuffer: TAR_MAX_BUFFER_BYTES });
  if (result.error) {
    throw new Error(`tar could not be spawned: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`tar ${args.join(" ")} failed: ${result.stderr.toString("utf8").trim()}`);
  }
  return result.stdout;
}

/**
 * @brief Extracts the shipped runtime bundle from a release tarball.
 * @details Reads the single `package/dist/cli.js` member into memory without touching any other
 * tarball entry, so no repository file besides the runtime bundle can be replaced.
 * @param tarballPath {string} Absolute path of the release tarball.
 * @return {Buffer} Packed runtime bundle bytes.
 * @throws {Error} When extraction fails or the member is empty.
 * @note Complexity O(bundle size).
 */
function extractPackedBundle(tarballPath) {
  const bytes = runTar(["-xzOf", tarballPath, PACKED_BUNDLE_MEMBER]);
  if (bytes.length === 0) {
    throw new Error(`packed member ${PACKED_BUNDLE_MEMBER} is empty`);
  }
  return bytes;
}

/**
 * @brief Runs the repository `build` lifecycle through npm.
 * @details Keeps source builds authoritative whenever the compiler toolchain is linked.
 * @return {number} Child exit code; 1 when npm cannot be spawned or reports no status.
 * @note Complexity O(build time).
 */
function buildFromSources() {
  const result = spawnSync(NPM_EXECUTABLE, ["run", "build"], { cwd: PROJECT_ROOT, stdio: "inherit" });
  if (result.error) {
    log(`npm run build could not be spawned: ${result.error.message}`);
    return 1;
  }
  return typeof result.status === "number" ? result.status : 1;
}

/**
 * @brief Restores the runtime bundle from the committed current-version release tarball.
 * @details Writes only `dist/cli.js`; the tarball is read-only input and stays in place.
 * @param tarballPath {string} Absolute release tarball path.
 * @return {number} 0 when the bundle was written; 1 with a stderr diagnostic otherwise.
 * @note Complexity O(bundle size).
 */
function restoreFromReleaseTarball(tarballPath) {
  try {
    const bytes = extractPackedBundle(tarballPath);
    const bundlePath = join(PROJECT_ROOT, RUNTIME_BUNDLE_RELATIVE_PATH);
    mkdirSync(dirname(bundlePath), { recursive: true });
    writeFileSync(bundlePath, bytes);
    log(`restored ${RUNTIME_BUNDLE_RELATIVE_PATH} from committed release tarball ${tarballPath}`);
    return 0;
  } catch (error) {
    log(`cannot restore ${RUNTIME_BUNDLE_RELATIVE_PATH} from ${tarballPath}: ${error.message}`);
    return 1;
  }
}

/**
 * @brief Resolves the committed release tarball path of the declared package version.
 * @details `dist/<package name>-<version>.tgz` is the single version-controlled `dist/` entry
 * (PKG-090, PKG-091); any other filename is ignored.
 * @return {string} Absolute tarball path, existing or not.
 * @note Complexity O(1); no side effects.
 */
function resolveReleaseTarballPath() {
  const identity = readPackageIdentity();
  return join(PROJECT_ROOT, DIST_DIRECTORY_RELATIVE_PATH, `${identity.name}-${identity.version}.tgz`);
}

/**
 * @brief Main prepare-stage decision procedure.
 * @details Bundle present -> no-op; committed release tarball present -> unpack it; compiler
 * linked -> source build; otherwise abort with remediation (PRJ-021).
 * @return {number} Process exit code.
 * @satisfies PKG-005, PKG-019, PKG-091, PKG-113, PRJ-020, PRJ-021, REQ-171
 */
function main() {
  if (isNonEmptyFile(join(PROJECT_ROOT, RUNTIME_BUNDLE_RELATIVE_PATH))) {
    log(`${RUNTIME_BUNDLE_RELATIVE_PATH} already present; nothing to do`);
    return 0;
  }
  const tarballPath = resolveReleaseTarballPath();
  if (existsSync(tarballPath)) {
    return restoreFromReleaseTarball(tarballPath);
  }
  if (isNonEmptyFile(join(PROJECT_ROOT, COMPILER_RELATIVE_PATH))) {
    log(`building ${RUNTIME_BUNDLE_RELATIVE_PATH} with the linked compiler toolchain`);
    return buildFromSources();
  }
  log(`cannot produce ${RUNTIME_BUNDLE_RELATIVE_PATH}: ${tarballPath} is absent and ${COMPILER_RELATIVE_PATH} is not linked`);
  log('Remediation: run "npm install" then "npm run build" in this checkout, or install a tagged release commit that ships its release tarball.');
  return 1;
}

process.exitCode = main();
