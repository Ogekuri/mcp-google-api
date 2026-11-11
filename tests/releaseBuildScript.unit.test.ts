/**
 * @fileoverview Release build contract suite for `scripts/build.sh` import integrity.
 *
 * @brief Verifies that the tracked release build fails when an emitted ESM entry imports a
 * relative module that was not generated (PKG-069, PKG-074), and succeeds when every relative
 * import resolves.
 * @details UUT: the tracked shell script `scripts/build.sh`, executed from a temp-directory
 * sandbox whose toolchain is replaced by stubs: `node_modules/.bin/tsup` emits `dist/cli.js`,
 * `dist/index.js`, optionally with the chunk module they import; the
 * `npm` stub resolves `run build` to the tsup stub and `pack` to a tar-readable tarball. Enforced
 * contract: the build exits non-zero and names the dangling import when `./chunk-ABC.js` is absent,
 * and leaves no partial `dist/` behind (PKG-073); with every relative import resolved the build
 * exits 0, writes no tarball or declaration file into `dist/` (PKG-069, PKG-102), and packs `<name>-<version>.tgz` only into its private work directory (PKG-070, PKG-074). Isolation: `PATH` is prefixed with
 * the stub directory only for the child process; the sandbox is removed in `finally`; no network,
 * no dependency installation, no write into the repository tree.
 * @note HDT level 1 (composed): depends on the shell runtime (`bash`, `tar`, `node`) as isolated
 * external boundaries. Test cases are independent and each owns its sandbox.
 * @satisfies PKG-069, PKG-070, PKG-073, PKG-074, PKG-102, TST-024
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root resolved from this suite location (cwd-independent). */
const PROJECT_ROOT: string = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Tracked release build script under test. */
const BUILD_SCRIPT: string = join(PROJECT_ROOT, "scripts", "build.sh");

/** Sandbox package identity; the tarball name derives from it (PKG-070). */
const FIXTURE_NAME = "fixture-pkg";
const FIXTURE_VERSION = "1.0.0";
const FIXTURE_TARBALL = `${FIXTURE_NAME}-${FIXTURE_VERSION}.tgz`;

/** Relative chunk module imported by the fixture entries; omitted in the failing scenario. */
const FIXTURE_CHUNK = "chunk-ABC.js";

/** Upper bound in milliseconds for one sandboxed build run. */
const BUILD_TIMEOUT_MS = 120000;

/** Sandbox `npm` stub source: `run build` delegates to tsup; `pack` writes a tar-readable tarball. */
const NPM_STUB: string = [
  "#!/usr/bin/env bash",
  "set -euo pipefail",
  'if [ "$1" = "run" ] && [ "$2" = "build" ]; then',
  "  exec ./node_modules/.bin/tsup",
  "fi",
  'if [ "$1" = "pack" ]; then',
  '  stage="$(mktemp -d)"',
  '  mkdir -p "$stage/package"',
  "  printf '{}\\n' > \"$stage/package/package.json\"",
  `  tar -czf "$5/${FIXTURE_TARBALL}" -C "$stage" package`,
  '  rm -rf "$stage"',
  `  printf '[{"filename":"${FIXTURE_TARBALL}"}]\\n'`,
  "  exit 0",
  "fi",
  'echo "npm stub: unsupported invocation: $*" >&2',
  "exit 2",
  "",
].join("\n");

/** Sandbox tsup stub source: emits the runtime entry files; the chunk only when requested. */
const TSUP_STUB: string = [
  "#!/usr/bin/env bash",
  "set -euo pipefail",
  "rm -rf dist",
  "mkdir -p dist",
  `printf 'import { value } from "./${FIXTURE_CHUNK}";\\nconsole.log(value);\\n' > dist/cli.js`,
  `printf 'export { value } from "./${FIXTURE_CHUNK}";\\n' > dist/index.js`,
  'if [ "${FIXTURE_WRITE_CHUNK:-0}" = "1" ]; then',
  `  printf 'export const value = 1;\\n' > dist/${FIXTURE_CHUNK}`,
  "fi",
  "",
].join("\n");

/** Temp-directory sandbox handles: repository-shaped root plus the stub `PATH` directory. */
interface BuildSandbox {
  /** Sandbox root containing `scripts/build.sh`, `package.json`, and `node_modules/.bin/tsup`. */
  readonly root: string;
  /** Directory holding the `npm` stub, prepended to `PATH` for the child process only. */
  readonly binDir: string;
}

/**
 * @brief Writes one executable script file.
 * @details Writes the content and sets mode 0755. Side effect: creates or overwrites `path`.
 * Complexity O(n) in content length.
 * @param path {string} Absolute destination path inside the sandbox.
 * @param content {string} Complete POSIX shell script text.
 * @return {void}
 * @throws {Error} When the file cannot be written or its mode cannot be set.
 */
function writeExecutable(path: string, content: string): void {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

/**
 * @brief Creates an isolated build sandbox with the tracked build script and stub toolchain.
 * @details Creates a temp directory under the OS temp root containing a copy of the tracked
 * `scripts/build.sh`, a fixture `package.json` (ESM, `name`/`version` from the constants), the tsup
 * stub under `node_modules/.bin/`, and an `npm` stub under a separate bin directory. Complexity O(1)
 * filesystem operations.
 * @return {BuildSandbox} Sandbox handles; the caller MUST remove `root` in a `finally` block.
 * @throws {Error} When the sandbox directories or files cannot be created.
 * @side_effect Creates one directory tree under the OS temp root.
 */
function createSandbox(): BuildSandbox {
  const root = mkdtempSync(join(tmpdir(), "release-build-contract-"));
  const binDir = join(root, "stub-bin");
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "node_modules", ".bin"), { recursive: true });
  mkdirSync(binDir);
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({ name: FIXTURE_NAME, version: FIXTURE_VERSION, type: "module" }, null, 2)}\n`,
  );
  copyFileSync(BUILD_SCRIPT, join(root, "scripts", "build.sh"));
  writeExecutable(join(root, "node_modules", ".bin", "tsup"), TSUP_STUB);
  writeExecutable(join(binDir, "npm"), NPM_STUB);
  return { root, binDir };
}

/**
 * @brief Runs the sandboxed copy of `scripts/build.sh` as a bash child process.
 * @details Executes from the sandbox root with `PATH` prefixed by the `npm` stub directory and
 * `FIXTURE_WRITE_CHUNK` set to `1` or `0` to control whether the tsup stub emits the chunk module.
 * Output is captured as UTF-8 text; the child is bounded by `BUILD_TIMEOUT_MS`. Complexity O(build
 * output size) plus one child process.
 * @param sandbox {BuildSandbox} Sandbox produced by `createSandbox`.
 * @param writeChunk {boolean} True when the tsup stub must emit `./chunk-ABC.js`.
 * @return {SpawnSyncReturns<string>} Child exit status and captured stdout/stderr.
 * @throws {Error} When bash cannot be spawned.
 */
function runBuild(sandbox: BuildSandbox, writeChunk: boolean): SpawnSyncReturns<string> {
  return spawnSync("bash", [join(sandbox.root, "scripts", "build.sh")], {
    cwd: sandbox.root,
    encoding: "utf8",
    timeout: BUILD_TIMEOUT_MS,
    env: {
      ...process.env,
      PATH: `${sandbox.binDir}:${process.env.PATH ?? ""}`,
      FIXTURE_WRITE_CHUNK: writeChunk ? "1" : "0",
    },
  });
}

/**
 * @brief Reproducer: a dangling relative chunk import must fail the release build.
 * @details Sandbox run with the tsup stub omitting `./chunk-ABC.js`. Expects non-zero exit, a
 * diagnostic naming the chunk, and no `dist/` residue. Complexity O(build) plus one bash child.
 * @satisfies PKG-069, PKG-073, PKG-074
 */
test("test_build_fails_when_relative_chunk_import_is_missing", () => {
  // PKG-069/PKG-074: dist/cli.js imports ./chunk-ABC.js which the bundler did not emit.
  // The build MUST exit non-zero, name the dangling import, and leave no partial dist/ (PKG-073).
  // Arrange
  const sandbox = createSandbox();
  try {
    // Act
    const result = runBuild(sandbox, false);
    // Assert
    assert.notEqual(result.status, 0, "build must fail on a dangling relative import (PKG-074)");
    assert.equal(result.stderr.includes(FIXTURE_CHUNK), true, `diagnostic must name "${FIXTURE_CHUNK}"`);
    assert.equal(existsSync(join(sandbox.root, "dist")), false, "failed build must leave no partial dist/ (PKG-073)");
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true });
  }
});

/**
 * @brief Regression case: successful builds preserve pre-existing empty directories.
 * @details Seeds an empty non-generated directory before the sandbox build; asserts exit 0 and
 * path existence afterward. The npm/tsup stubs isolate the build and no repository path is written.
 * Complexity O(build) plus one bash child.
 * @return {void} No value; assertions throw on a failed preservation condition.
 * @throws {AssertionError} When the build fails or the directory is absent after completion.
 * @satisfies PKG-071, PKG-072
 */
test("test_build_preserves_preexisting_empty_directory", () => {
  // Arrange
  const sandbox = createSandbox();
  const emptyDirectory = join(sandbox.root, "dist", "preserve-empty");
  try {
    mkdirSync(emptyDirectory, { recursive: true });
    // Act
    const result = runBuild(sandbox, true);
    // Assert
    const expected_output = { exitCode: 0, directoryPreserved: true };
    assert.equal(result.status, expected_output.exitCode, result.stderr);
    assert.equal(existsSync(emptyDirectory), expected_output.directoryPreserved);
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true });
  }
});

/**
 * @brief Regression case: successful builds preserve pre-existing symbolic links.
 * @details Seeds a non-generated symlink in `dist/` pointing to a sandbox file; asserts exit 0,
 * symlink type, and identical link target afterward. The build toolchain is stubbed and isolated.
 * Complexity O(build) plus one bash child.
 * @return {void} No value; assertions throw on a failed preservation condition.
 * @throws {AssertionError} When the build fails or the link type/target changes.
 * @satisfies PKG-071, PKG-072
 */
test("test_build_preserves_preexisting_symlink", () => {
  // Arrange
  const sandbox = createSandbox();
  const linkTarget = join(sandbox.root, "symlink-target.txt");
  const linkPath = join(sandbox.root, "dist", "preserve-link");
  try {
    writeFileSync(linkTarget, "symlink target\n");
    mkdirSync(join(sandbox.root, "dist"), { recursive: true });
    symlinkSync(linkTarget, linkPath);
    // Act
    const result = runBuild(sandbox, true);
    // Assert
    const expected_output = { exitCode: 0, linkExists: true, isSymlink: true, target: linkTarget };
    assert.equal(result.status, expected_output.exitCode, result.stderr);
    assert.equal(existsSync(linkPath), expected_output.linkExists);
    assert.equal(lstatSync(linkPath).isSymbolicLink(), expected_output.isSymlink);
    assert.equal(readlinkSync(linkPath), expected_output.target);
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true });
  }
});

/**
 * @brief Regression case: output-path collisions fail and restore the complete pre-run directory.
 * @details Seeds a non-generated symlink at the generated `dist/cli.js` path and an empty directory.
 * The build MUST fail rather than overwrite the symlink; the EXIT trap MUST restore both entries.
 * The npm/tsup stubs isolate the child process. Complexity O(build) plus one bash child.
 * @return {void} No value; assertions throw when failure or rollback behavior differs.
 * @throws {AssertionError} When the build succeeds or the original entries are not restored.
 * @satisfies PKG-071, PKG-072, PKG-073
 */
test("test_build_restores_snapshot_on_non_generated_path_collision", () => {
  // Arrange
  const sandbox = createSandbox();
  const linkTarget = join(sandbox.root, "original-cli-target.txt");
  const cliEntryPath = join(sandbox.root, "dist", "cli.js");
  const emptyDirectory = join(sandbox.root, "dist", "preserve-empty");
  try {
    writeFileSync(linkTarget, "original cli target\n");
    mkdirSync(emptyDirectory, { recursive: true });
    symlinkSync(linkTarget, cliEntryPath);
    // Act
    const result = runBuild(sandbox, true);
    // Assert
    const expected_output = {
      exitCode: 1,
      linkRestored: true,
      directoryRestored: true,
      target: linkTarget,
    };
    assert.equal(result.status, expected_output.exitCode, "conflicting output path must abort the build");
    assert.equal(lstatSync(cliEntryPath).isSymbolicLink(), expected_output.linkRestored);
    assert.equal(readlinkSync(cliEntryPath), expected_output.target);
    assert.equal(existsSync(emptyDirectory), expected_output.directoryRestored);
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true });
  }
});

/**
 * @brief Positive control: every relative import resolved must yield a successful release build.
 * @details Sandbox run with the tsup stub emitting `./chunk-ABC.js`. Expects exit 0, the chunk, and
 * no tarball or declaration file in `dist/`. Complexity O(build) plus one bash child.
 * @return {void} No value; assertions throw on a failed build condition.
 * @throws {AssertionError} When the build fails or expected artifacts are absent.
 * @satisfies PKG-069, PKG-070, PKG-074, PKG-102
 */
test("test_build_succeeds_when_every_relative_import_resolves", () => {
  // PKG-069/PKG-070/PKG-102/PKG-074: every relative import resolves; the build exits 0, keeps the
  // chunk in dist/, and leaves no tarball or declaration file in dist/. Positive control for the
  // failing scenario above.
  // Arrange
  const sandbox = createSandbox();
  try {
    // Act
    const result = runBuild(sandbox, true);
    // Assert
    assert.equal(result.status, 0, `build must succeed when imports resolve; stderr: ${result.stderr}`);
    assert.equal(existsSync(join(sandbox.root, "dist", FIXTURE_CHUNK)), true, "chunk must remain in dist/");
    assert.equal(existsSync(join(sandbox.root, "dist", FIXTURE_TARBALL)), false, "tarball must not be written into dist/ (PKG-102)");
    assert.equal(existsSync(join(sandbox.root, "dist", "cli.d.ts")), false, "declaration files must not be written into dist/ (PKG-069)");
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true });
  }
});
