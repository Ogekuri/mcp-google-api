/**
 * @fileoverview Release-archive preservation contract suite for the `build`/`prepare` lifecycle.
 *
 * @brief Verifies that the build lifecycle never destroys the committed release archive in `dist/`
 * (PKG-117), never removes other tracked `dist/` entries besides generated `dist/*.js` outputs
 * (PKG-118), prunes stale generated outputs before compiling (PKG-119), aborts before any removal
 * when the compiler binary is absent (PKG-120), restores the pre-run generated outputs when the
 * compile fails (PKG-121), and never leaves the tracked runtime bundle absent after a run (PKG-122).
 * @details UUT: the `package.json` `scripts.build` command chain, executed from a temp-directory
 * sandbox that holds the tracked `tools/prune-generated-dist.mjs` and a stub `tsup` emulating the
 * `clean: false` compiler configuration. Reproduced defect: the former `tsup` `clean: true`
 * configuration wiped the whole `dist/` outDir, deleting `dist/<name>-<version>.tgz`, so any
 * `npm ci`/`npm install` (which runs `prepare`) left the tracked tree dirty and the release artifact
 * set incomplete. Enforced contract: the release archive survives byte-identical, stale generated
 * outputs are pruned, non-generated entries and every `*.tgz` archive of any version are preserved,
 * and the compiler configuration declares no outDir wipe. Isolation: the sandbox lives under the OS
 * temp root and is removed in `finally`; no network, no dependency installation, no write into the
 * repository tree.
 * @note HDT level 1 (composed): external boundaries are the shell runtime (`bash`) and the Node.js
 * runtime. Test cases are independent and each owns its sandbox.
 * @satisfies PKG-117, PKG-118, PKG-119, PKG-120, PKG-121, PKG-122, TST-032, TST-033
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root resolved from this suite location (cwd-independent). */
const PROJECT_ROOT: string = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Tracked generated-output pruner invoked by the `build` lifecycle (PKG-119). */
const PRUNER_SCRIPT: string = join(PROJECT_ROOT, "tools", "prune-generated-dist.mjs");

/** Tracked `dist/` orchestration of the `build` lifecycle: preflight, prune, compile, restore (PKG-120, PKG-121). */
const LIFECYCLE_SCRIPT: string = join(PROJECT_ROOT, "tools", "build-dist-lifecycle.mjs");

/** Upper bound in milliseconds for one sandboxed lifecycle run. */
const BUILD_TIMEOUT_MS = 120000;

/** Stub chunk module emitted by the stub compiler; provides the shared-import positive control. */
const FIXTURE_CHUNK = "chunk-ABC.js";

/** Byte content of the seeded release archive; byte identity proves PKG-117 preservation. */
const ARCHIVE_CONTENT = "release archive payload of the committed build\n";

/** Stub `tsup` source: emits the runtime entries without ever wiping `dist/` (`clean: false`). */
const TSUP_STUB: string = [
  "#!/usr/bin/env bash",
  "set -euo pipefail",
  "mkdir -p dist",
  `printf 'export const value = 1;\\n' > dist/${FIXTURE_CHUNK}`,
  `printf 'import { value } from "./${FIXTURE_CHUNK}";\\nconsole.log(value);\\n' > dist/cli.js`,
  `printf 'export { value } from "./${FIXTURE_CHUNK}";\\n' > dist/index.js`,
  "",
].join("\n");

/** Stub `tsup` source emulating a failing compile that already emitted partial outputs (PKG-121). */
const TSUP_FAILING_STUB: string = [
  "#!/usr/bin/env bash",
  "set -euo pipefail",
  "mkdir -p dist",
  `printf 'export const partial = 1;\\n' > dist/${FIXTURE_CHUNK}`,
  "printf 'console.log(\"partial\");\\n' > dist/cli.js",
  "printf 'simulated compile failure\\n' >&2",
  "exit 1",
  "",
].join("\n");

/** Pre-run generated output seeded before a failing compile (PKG-121 byte-identity control). */
const PRE_RUN_CLI = "console.log('pre-run cli');\n";

/** Second pre-run generated output seeded before a failing compile (PKG-121 byte-identity control). */
const PRE_RUN_INDEX = "export const preRun = 1;\n";

/** Temp-directory sandbox handles for one lifecycle run. */
interface LifecycleSandbox {
  /** Sandbox root holding `package.json`, `tools/prune-generated-dist.mjs`, and the stub compiler. */
  readonly root: string;
  /** Build command chain declared by the tracked `package.json` `scripts.build`. */
  readonly buildCommand: string;
  /** Filename of the release archive derived from the sandbox package identity (PKG-070). */
  readonly archiveName: string;
}

/**
 * @brief Writes one executable script file.
 * @details Writes the content and sets mode 0755. Complexity O(n) in content length.
 * @param path {string} Absolute destination path inside the sandbox.
 * @param content {string} Complete POSIX shell script text.
 * @return {void}
 * @throws {Error} When the file cannot be written or its mode cannot be set.
 * @side_effect Creates or overwrites `path`.
 */
function writeExecutable(path: string, content: string): void {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

/**
 * @brief Loads the tracked `package.json` manifest.
 * @details Reads and parses the repository manifest to obtain the real `scripts.build` chain and
 * the package identity used by the archive name (PKG-070). Complexity O(file size).
 * @return {Record<string, unknown> & { name: string, version: string, scripts: Record<string, string> }}
 *         Parsed manifest.
 * @throws {Error} When the manifest is missing or is not valid JSON.
 */
function loadRepositoryManifest(): {
  name: string;
  version: string;
  scripts: Record<string, string>;
} {
  const raw = readFileSync(join(PROJECT_ROOT, "package.json"), "utf8");
  return JSON.parse(raw);
}

/**
 * @brief Creates an isolated `build`-lifecycle sandbox.
 * @details Creates a temp directory under the OS temp root containing a fixture `package.json`
 * that carries the tracked `scripts.build` command, copies of the tracked
 * `tools/prune-generated-dist.mjs` and `tools/build-dist-lifecycle.mjs`, and the stub compiler under
 * `node_modules/.bin/tsup` (omitted when `includeCompiler` is false, PKG-120 scenario).
 * Complexity O(1) filesystem operations plus three file copies.
 * @param buildCommand {string} Tracked `scripts.build` command chain under test.
 * @param includeCompiler {boolean} True to install the stub compiler; false to emulate a missing toolchain.
 * @param compilerStub {string} Stub compiler source written under `node_modules/.bin/tsup`.
 * @return {LifecycleSandbox} Sandbox handles; the caller MUST remove `root` in a `finally` block.
 * @throws {Error} When directories or files cannot be created.
 * @side_effect Creates one directory tree under the OS temp root.
 */
function createSandbox(
  buildCommand: string,
  includeCompiler = true,
  compilerStub: string = TSUP_STUB,
): LifecycleSandbox {
  const manifest = loadRepositoryManifest();
  const root = mkdtempSync(join(tmpdir(), "build-archive-contract-"));
  mkdirSync(join(root, "tools"), { recursive: true });
  mkdirSync(join(root, "node_modules", ".bin"), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify(
      { name: manifest.name, version: manifest.version, type: "module", scripts: { build: buildCommand } },
      null,
      2,
    )}\n`,
  );
  copyFileSync(PRUNER_SCRIPT, join(root, "tools", "prune-generated-dist.mjs"));
  copyFileSync(LIFECYCLE_SCRIPT, join(root, "tools", "build-dist-lifecycle.mjs"));
  if (includeCompiler) {
    writeExecutable(join(root, "node_modules", ".bin", "tsup"), compilerStub);
  }
  return {
    root,
    buildCommand,
    archiveName: `${manifest.name}-${manifest.version}.tgz`,
  };
}

/**
 * @brief Runs the sandbox `build` lifecycle command chain as a bash child process.
 * @details Executes the tracked command chain from the sandbox root with `node_modules/.bin`
 * prepended to `PATH` so the stub compiler resolves; output is captured as UTF-8 text and bounded
 * by `BUILD_TIMEOUT_MS`. Complexity O(build output size) plus one child process.
 * @param sandbox {LifecycleSandbox} Sandbox produced by `createSandbox`.
 * @return {SpawnSyncReturns<string>} Child exit status plus captured stdout/stderr.
 * @throws {Error} When bash cannot be spawned.
 */
function runBuildLifecycle(sandbox: LifecycleSandbox): SpawnSyncReturns<string> {
  return spawnSync("bash", ["-c", sandbox.buildCommand], {
    cwd: sandbox.root,
    encoding: "utf8",
    timeout: BUILD_TIMEOUT_MS,
    env: {
      ...process.env,
      PATH: `${join(sandbox.root, "node_modules", ".bin")}:${process.env.PATH ?? ""}`,
    },
  });
}

/**
 * @brief Seeds one file under the sandbox `dist/` directory.
 * @details Creates `dist/` on demand and writes the given bytes. Complexity O(n) in content length.
 * @param sandbox {LifecycleSandbox} Sandbox produced by `createSandbox`.
 * @param relativePath {string} Path relative to `dist/`.
 * @param content {string} File bytes to write.
 * @return {string} Absolute path of the seeded file.
 * @side_effect Creates directories and one file under the sandbox `dist/`.
 */
function seedDistFile(sandbox: LifecycleSandbox, relativePath: string, content: string): string {
  const absolutePath = join(sandbox.root, "dist", relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
  return absolutePath;
}

/**
 * @brief Reproducer: the build lifecycle must keep the committed release archive byte-identical.
 * @details Seeds the release archive plus stale generated outputs and one non-generated entry, runs
 * the tracked lifecycle, then asserts exit 0, archive byte identity, pruned stale outputs, preserved
 * non-generated entry, and regenerated runtime entries. Complexity O(build) plus one bash child.
 * @return {void} No value; assertions throw on a violated preservation contract.
 * @throws {AssertionError} When the lifecycle fails or mutates the release archive.
 * @satisfies PKG-117, PKG-118, PKG-119
 */
test("test_build_lifecycle_preserves_pre_existing_release_archive", () => {
  // PKG-117/PKG-118/PKG-119: `prepare`/`build` MUST NOT delete or rewrite the committed archive,
  // MUST prune stale generated outputs, and MUST preserve non-generated dist/ entries.
  // Arrange
  const sandbox = createSandbox(loadRepositoryManifest().scripts.build);
  const archivePath = seedDistFile(sandbox, sandbox.archiveName, ARCHIVE_CONTENT);
  const staleChunkPath = seedDistFile(sandbox, "chunk-OLDHASH.js", "export const stale = 1;\n");
  const staleStatePath = seedDistFile(sandbox, "release.tsbuildinfo", "stale build state\n");
  const nonGeneratedPath = seedDistFile(sandbox, "NOTE.txt", "non-generated entry\n");
  try {
    // Act
    const result = runBuildLifecycle(sandbox);
    // Assert
    assert.equal(result.status, 0, `build lifecycle must succeed; stderr: ${result.stderr}`);
    assert.equal(existsSync(archivePath), true, `release archive must survive the lifecycle at dist/${sandbox.archiveName} (PKG-117)`);
    assert.equal(readFileSync(archivePath, "utf8"), ARCHIVE_CONTENT, "release archive must stay byte-identical (PKG-117)");
    assert.equal(existsSync(staleChunkPath), false, "stale generated chunk must be pruned before compiling (PKG-119)");
    assert.equal(existsSync(staleStatePath), false, "stale build state file must be pruned (PKG-119)");
    assert.equal(existsSync(nonGeneratedPath), true, "non-generated dist/ entry must be preserved (PKG-118)");
    assert.equal(existsSync(join(sandbox.root, "dist", "cli.js")), true, "compiler must still emit dist/cli.js (PKG-069)");
    assert.equal(existsSync(join(sandbox.root, "dist", "index.js")), true, "compiler must still emit dist/index.js (PKG-069)");
    assert.equal(result.stdout.includes("removed stale generated output"), true, "pruner must report every removed output (PKG-119)");
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true });
  }
});

/**
 * @brief Archive contract: no tarball of any version is removed by the build lifecycle.
 * @details Seeds the current release archive plus a stale archive of another version, runs the
 * tracked lifecycle, and asserts both survive byte-identical, because stale-archive removal belongs
 * to `scripts/build.sh` alone (PKG-108, PKG-117). Complexity O(build) plus one bash child.
 * @return {void} No value; assertions throw when any archive is removed or rewritten.
 * @throws {AssertionError} When an archive disappears or its bytes change.
 * @satisfies PKG-117, PKG-119
 */
test("test_build_lifecycle_never_removes_archives_of_any_version", () => {
  // Arrange
  const sandbox = createSandbox(loadRepositoryManifest().scripts.build);
  const currentArchive = seedDistFile(sandbox, sandbox.archiveName, ARCHIVE_CONTENT);
  const staleArchive = seedDistFile(sandbox, "mcp-google-api-0.0.1.tgz", "archive of an earlier version\n");
  try {
    // Act
    const result = runBuildLifecycle(sandbox);
    // Assert
    assert.equal(result.status, 0, `build lifecycle must succeed; stderr: ${result.stderr}`);
    assert.equal(existsSync(currentArchive), true, "current release archive must survive (PKG-117)");
    assert.equal(readFileSync(currentArchive, "utf8"), ARCHIVE_CONTENT, "current release archive must stay byte-identical (PKG-117)");
    assert.equal(existsSync(staleArchive), true, "archive cleanup belongs to scripts/build.sh only, never to the build lifecycle (PKG-117)");
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true });
  }
});

/**
 * @brief Regression guard: the compiler configuration must not wipe the `dist/` outDir.
 * @details Static inspection of `tsup.config.ts`: requires `clean: false` and rejects
 * `clean: true`, the configuration that deleted the tracked release archive (PKG-117).
 * Pure; no build, no network. Complexity O(n) in config length.
 * @return {void} No value; assertions throw when the wipe is re-enabled.
 * @throws {AssertionError} When `clean: false` is absent or `clean: true` is declared.
 * @satisfies PKG-117
 */
test("test_release_compiler_config_does_not_clean_dist", () => {
  // Arrange
  const config = readFileSync(join(PROJECT_ROOT, "tsup.config.ts"), "utf8");
  // Act
  const declaresNoWipe = /clean\s*:\s*false/.test(config);
  const declaresWipe = /clean\s*:\s*true/.test(config);
  // Assert
  assert.equal(declaresNoWipe, true, "tsup.config.ts must declare clean: false so the archived release survives (PKG-117)");
  assert.equal(declaresWipe, false, "tsup.config.ts must not wipe dist/ with clean: true (PKG-117)");
});

/**
 * @brief Wiring guard: the `build` script must orchestrate the pruner before the compiler.
 * @details Static inspection of `package.json` `scripts.build` (the tracked lifecycle orchestrator)
 * and of `tools/build-dist-lifecycle.mjs`: requires the lifecycle invocation as the only build step
 * and the tracked pruner invocation ahead of the compiler inside it (PKG-119, PKG-121). Pure.
 * @return {void} No value; assertions throw on an incomplete wiring.
 * @throws {AssertionError} When the lifecycle is not wired, the pruner is not invoked first, or a
 *         script file is absent.
 * @satisfies PKG-119, PKG-121
 */
test("test_build_script_runs_generated_pruner_before_compiler", () => {
  // Arrange
  const buildCommand = loadRepositoryManifest().scripts.build;
  const lifecycleSource = readFileSync(LIFECYCLE_SCRIPT, "utf8");
  const prunerPosition = lifecycleSource.indexOf("prune-generated-dist.mjs");
  const compilerPosition = lifecycleSource.indexOf("TSUP_BIN");
  // Act
  const lifecycleWired = buildCommand.includes("node tools/build-dist-lifecycle.mjs");
  const prunerRunsFirst = prunerPosition >= 0 && compilerPosition > prunerPosition;
  // Assert
  assert.equal(lifecycleWired, true, `scripts.build must run the tracked dist lifecycle orchestrator (PKG-121): ${buildCommand}`);
  assert.equal(prunerRunsFirst, true, "the lifecycle must run the generated pruner before the compiler (PKG-119)");
  assert.equal(existsSync(PRUNER_SCRIPT), true, "tools/prune-generated-dist.mjs must exist (PKG-119)");
  assert.equal(existsSync(LIFECYCLE_SCRIPT), true, "tools/build-dist-lifecycle.mjs must exist (PKG-121)");
});

/**
 * @brief Failure contract: a `dist` path that is not a directory aborts the build lifecycle.
 * @details Replaces `dist/` with a regular file, runs the tracked lifecycle, and asserts a non-zero
 * exit with an unchanged file, so the pruner never guesses or deletes unknown content (PKG-119).
 * Complexity O(build) plus one bash child.
 * @return {void} No value; assertions throw when the lifecycle succeeds or destroys the entry.
 * @throws {AssertionError} When the lifecycle exits 0 or the file content changes.
 * @satisfies PKG-119
 */
test("test_build_lifecycle_fails_when_dist_is_not_a_directory", () => {
  // Arrange
  const sandbox = createSandbox(loadRepositoryManifest().scripts.build);
  const distPath = join(sandbox.root, "dist");
  writeFileSync(distPath, "not a directory\n");
  try {
    // Act
    const result = runBuildLifecycle(sandbox);
    // Assert
    assert.notEqual(result.status, 0, "a non-directory dist/ must abort the lifecycle (PKG-119)");
    assert.equal(result.stderr.includes("is not a directory"), true, "diagnostic must name the unusable dist/ path (PKG-119)");
    assert.equal(readFileSync(distPath, "utf8"), "not a directory\n", "the offending entry must not be modified (PKG-118)");
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true });
  }
});

/**
 * @brief Preflight contract: a missing compiler aborts the lifecycle without touching `dist/`.
 * @details Creates a sandbox without `node_modules/.bin/tsup`, seeds a tracked runtime bundle plus
 * the release archive, runs the tracked lifecycle, and asserts a non-zero exit with a diagnostic
 * naming the compiler and a byte-identical, still-complete `dist/` tree (PKG-120, PKG-122).
 * Complexity O(build) plus one bash child.
 * @return {void} No value; assertions throw when the lifecycle removes or rewrites any entry.
 * @throws {AssertionError} When the lifecycle exits 0, drops a runtime artifact, or rewrites bytes.
 * @satisfies PKG-120, PKG-122
 */
test("test_build_lifecycle_aborts_without_touching_dist_when_compiler_missing", () => {
  // Arrange
  const sandbox = createSandbox(loadRepositoryManifest().scripts.build, false);
  const archivePath = seedDistFile(sandbox, sandbox.archiveName, ARCHIVE_CONTENT);
  const cliPath = seedDistFile(sandbox, "cli.js", PRE_RUN_CLI);
  const indexPath = seedDistFile(sandbox, "index.js", PRE_RUN_INDEX);
  try {
    // Act
    const result = runBuildLifecycle(sandbox);
    // Assert
    assert.notEqual(result.status, 0, "a missing compiler must abort the lifecycle (PKG-120)");
    assert.equal(
      result.stderr.includes("node_modules/.bin/tsup"),
      true,
      `diagnostic must name the missing compiler (PKG-120); stderr: ${result.stderr}`,
    );
    assert.equal(result.stderr.includes("dist/ was not modified"), true, "diagnostic must state that dist/ was not modified (PKG-120)");
    assert.equal(readFileSync(cliPath, "utf8"), PRE_RUN_CLI, "tracked dist/cli.js must stay byte-identical (PKG-122)");
    assert.equal(readFileSync(indexPath, "utf8"), PRE_RUN_INDEX, "tracked dist/index.js must stay byte-identical (PKG-122)");
    assert.equal(readFileSync(archivePath, "utf8"), ARCHIVE_CONTENT, "release archive must stay byte-identical (PKG-117)");
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true });
  }
});

/**
 * @brief Recovery contract: a failing compile restores the pre-run generated outputs.
 * @details Seeds the tracked runtime bundle plus the release archive, installs a stub compiler that
 * emits partial outputs and fails, runs the tracked lifecycle, and asserts a non-zero exit with the
 * pre-run generated outputs restored byte-identically, the partial output removed, and the archive
 * untouched (PKG-121, PKG-122, PKG-117). Complexity O(build) plus one bash child.
 * @return {void} No value; assertions throw when the lifecycle leaves a partial output set.
 * @throws {AssertionError} When the lifecycle exits 0, keeps partial outputs, or rewrites entries.
 * @satisfies PKG-117, PKG-121, PKG-122
 */
test("test_build_lifecycle_restores_generated_outputs_when_compiler_fails", () => {
  // Arrange
  const sandbox = createSandbox(loadRepositoryManifest().scripts.build, true, TSUP_FAILING_STUB);
  const archivePath = seedDistFile(sandbox, sandbox.archiveName, ARCHIVE_CONTENT);
  const cliPath = seedDistFile(sandbox, "cli.js", PRE_RUN_CLI);
  const indexPath = seedDistFile(sandbox, "index.js", PRE_RUN_INDEX);
  const partialChunkPath = join(sandbox.root, "dist", FIXTURE_CHUNK);
  try {
    // Act
    const result = runBuildLifecycle(sandbox);
    // Assert
    assert.notEqual(result.status, 0, "a failing compile must abort the lifecycle (PKG-121)");
    assert.equal(result.stderr.includes("dist/ restored"), true, `diagnostic must report the restore (PKG-121); stderr: ${result.stderr}`);
    assert.equal(readFileSync(cliPath, "utf8"), PRE_RUN_CLI, "pre-run dist/cli.js must be restored byte-identically (PKG-121)");
    assert.equal(readFileSync(indexPath, "utf8"), PRE_RUN_INDEX, "pre-run dist/index.js must be restored byte-identically (PKG-121)");
    assert.equal(existsSync(partialChunkPath), false, "partial compile output must not survive the restore (PKG-121)");
    assert.equal(readFileSync(archivePath, "utf8"), ARCHIVE_CONTENT, "release archive must stay byte-identical (PKG-117)");
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true });
  }
});
