/**
 * @fileoverview Launcher bundle-source contract suite for `scripts/mcp-google-api.sh`.
 *
 * @brief Guards the ordered runtime-bundle resolution declared by PRJ-019, PRJ-024, PRJ-026, and
 * PRJ-029: the linked compiler is preferred, the committed release tarball is the fallback, a
 * launcher with neither source aborts naming both, and no path mutates or depends on other `dist/`
 * entries.
 * @details UUT: the tracked shell script `scripts/mcp-google-api.sh` plus sandboxed runs against
 * temp-dir copies seeded with fixture bundle sources. Enforced contract:
 * - compiler-preferred rebuild (PRJ-019): an executable `node_modules/.bin/tsup` stub emitting
 *   `cli.js` is executed and its bundle is launched, even when a release tarball is also present;
 * - release-artifact fallback (PRJ-029): without the compiler, `package/dist/cli.js` is extracted
 *   from the committed `<name>-<version>.tgz` release tarball into the private temporary directory
 *   and launched;
 * - dual-source abort (PRJ-024): without compiler and without release tarball the launcher exits
 *   non-zero naming both missing sources and the manual remediation commands;
 * - `dist/` invariance (PRJ-025, PRJ-026): the seeded release tarball stays byte-identical and no
 *   `dist/` entry is created, modified, or deleted;
 * - cleanup (PRJ-027, PRJ-028): every run leaves no `mcp-google-api-run.*` directory behind and
 *   argument forwarding plus exit-code propagation match PRJ-022.
 * - packaged skills materialization (PRJ-018, PKG-024): the private temporary package root exposes
 *   the repository `skills/` payload, so bundle commands that resolve `<packageRoot>/skills`
 *   (`show`, `install`, `uninstall`, `api-key`) execute instead of aborting.
 * @note HDT level 1: one static ordering assertion plus sandboxed child-process runs in private
 * temporary directories. Offline and deterministic: the fixture compiler, the fixture release
 * tarball, and the fixture runtime bundle are created by this suite.
 * @satisfies PRJ-018, PRJ-019, PRJ-022, PRJ-024, PRJ-025, PRJ-026, PRJ-027, PRJ-028, PRJ-029, PKG-024, TST-035
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root resolved from this suite location (cwd-independent). */
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Repository-relative path of the tracked launcher under test. */
const SCRIPT_RELATIVE_PATH = "scripts/mcp-google-api.sh";

/** Sandbox package name declaring the expected release tarball basename (PKG-091, PRJ-029). */
const SANDBOX_PACKAGE_NAME = "launcher-fixture";

/** Sandbox package version declaring the expected release tarball basename (PRJ-029). */
const SANDBOX_PACKAGE_VERSION = "9.9.9";

/** Expected sandbox release tarball basename (PRJ-029). */
const SANDBOX_TARBALL_NAME = `${SANDBOX_PACKAGE_NAME}-${SANDBOX_PACKAGE_VERSION}.tgz`;

/** Packed member holding the shipped runtime bundle inside every release tarball (PRJ-029). */
const PACKED_BUNDLE_MEMBER = join("package", "dist", "cli.js");

/** Sandbox-relative compiler launcher the launcher probes before the release artifact (PRJ-019). */
const COMPILER_RELATIVE_PATH = join("node_modules", ".bin", "tsup");

/** Marker prefix identifying which bundle source produced the launched entry (PRJ-019, PRJ-029). */
const SOURCE_MARKER_PREFIX = "launcher-source=";

/** Environment variable driving the fixture bundle exit code (PRJ-022). */
const EXIT_CODE_ENV = "LAUNCHER_TEST_EXIT_CODE";

/** Upper bound in milliseconds for one sandboxed launcher run. */
const SANDBOX_TIMEOUT_MS = 60000;

/** Fixture runtime bundle template parameterized by its source marker. */
function fixtureBundle(source: string): string {
  return [
    `console.log("${SOURCE_MARKER_PREFIX}${source}");`,
    "console.log(JSON.stringify(process.argv.slice(2)));",
    `process.exit(Number(process.env.${EXIT_CODE_ENV} ?? "0"));`,
    "",
  ].join("\n");
}

/**
 * @brief Fixture runtime bundle reading the packaged skills manifest from its package root.
 * @details Mirrors the production bundle layout contract: the emitted entry sits in
 * `<packageRoot>/build/cli.js` and every skills-consuming command resolves
 * `<packageRoot>/skills/manifest.json` (PKG-024). The fixture prints the resolved skill count so a
 * sandboxed run proves the private temporary package root exposes the repository skills payload.
 * @param source {string} Bundle-source marker printed on stdout.
 * @return {string} ESM fixture bundle body.
 */
function skillsProbeBundle(source: string): string {
  return [
    'import { readFileSync } from "node:fs";',
    'import { dirname, join } from "node:path";',
    'import { fileURLToPath } from "node:url";',
    'const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");',
    'const manifest = JSON.parse(readFileSync(join(packageRoot, "skills", "manifest.json"), "utf8"));',
    `console.log("${SOURCE_MARKER_PREFIX}${source}:skills=" + manifest.skills.length);`,
    "",
  ].join("\n");
}

/**
 * @brief Seeds a tracked-layout skills payload in the sandbox repository root.
 * @details Writes `<sandbox>/skills/manifest.json` with one skill entry, the layout the published
 * package ships at its package root (PKG-024).
 * @param sandbox {string} Sandbox repository root.
 * @return {string} Absolute seeded skills root.
 */
function writeSkillsFixture(sandbox: string): string {
  const skillsRoot = join(sandbox, "skills");
  mkdirSync(join(skillsRoot, "demo-skill"), { recursive: true });
  writeFileSync(
    join(skillsRoot, "manifest.json"),
    `${JSON.stringify({ version: 1, skills: [{ id: "demo-skill", path: "demo-skill/SKILL.md" }] }, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(join(skillsRoot, "demo-skill", "SKILL.md"), "---\nname: demo-skill\ndescription: demo\n---\n", "utf8");
  return skillsRoot;
}

/**
 * @brief Loads the tracked launcher script.
 * @details Synchronous read of the repository-root script; comment lines are preserved so the
 * static assertions can inspect the documented bundle-source ordering.
 * @return {string} Raw script content.
 * @throws {Error} When the script is missing or unreadable.
 */
function loadLauncherScript(): string {
  return readFileSync(join(PROJECT_ROOT, SCRIPT_RELATIVE_PATH), "utf8");
}

/**
 * @brief Creates an isolated sandbox declaring the fixture package identity.
 * @details Copies the tracked launcher so the sandbox resolves as its own repository root, seeds
 * `package.json` with the fixture name/version, and creates the `dist` directory.
 * Complexity O(file size); the caller MUST remove the returned directory.
 * @return {string} Absolute sandbox directory path.
 */
function createSandbox(): string {
  const sandbox = mkdtempSync(join(tmpdir(), "mcp-google-api-launcher-"));
  const scriptPath = join(sandbox, "scripts", "mcp-google-api.sh");
  mkdirSync(dirname(scriptPath), { recursive: true });
  writeFileSync(scriptPath, loadLauncherScript(), "utf8");
  chmodSync(scriptPath, 0o755);
  writeFileSync(
    join(sandbox, "package.json"),
    `${JSON.stringify({ name: SANDBOX_PACKAGE_NAME, version: SANDBOX_PACKAGE_VERSION }, null, 2)}\n`,
    "utf8",
  );
  mkdirSync(join(sandbox, "dist"), { recursive: true });
  return sandbox;
}

/**
 * @brief Seeds an executable fixture compiler that emits a recognized runtime bundle.
 * @details The stub honors `--out-dir` exactly like the compiler contract consumed by the launcher,
 * so the compiler-preferred branch is observable through the emitted marker.
 * @param sandbox {string} Sandbox repository root.
 * @return {string} Absolute compiler stub path.
 */
function writeCompilerStub(sandbox: string, bundleBody: string = fixtureBundle("compiler")): string {
  const compilerPath = join(sandbox, COMPILER_RELATIVE_PATH);
  mkdirSync(dirname(compilerPath), { recursive: true });
  const stub = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    'out_dir=""',
    'while [ "$#" -gt 0 ]; do',
    '  case "$1" in',
    '    --out-dir) out_dir="$2"; shift 2 ;;',
    "    *) shift ;;",
    "  esac",
    "done",
    'if [ -z "$out_dir" ]; then',
    "  printf 'compiler stub: missing --out-dir\\n' >&2",
    "  exit 1",
    "fi",
    'mkdir -p "$out_dir"',
    `printf '%s' '${bundleBody}' >"$out_dir/cli.js"`,
    "",
  ].join("\n");
  writeFileSync(compilerPath, stub, "utf8");
  chmodSync(compilerPath, 0o755);
  return compilerPath;
}

/**
 * @brief Seeds the committed release tarball carrying a recognized runtime bundle.
 * @details Builds a real gzipped tarball whose only relevant member is `package/dist/cli.js`, the
 * packed member path extracted by the PRJ-029 fallback.
 * @param sandbox {string} Sandbox repository root.
 * @return {string} Absolute seeded release tarball path.
 */
function writeReleaseTarball(sandbox: string): string {
  const staging = mkdtempSync(join(tmpdir(), "mcp-google-api-launcher-pack-"));
  const memberPath = join(staging, PACKED_BUNDLE_MEMBER);
  mkdirSync(dirname(memberPath), { recursive: true });
  writeFileSync(memberPath, fixtureBundle("release-tarball"), "utf8");
  const tarballPath = join(sandbox, "dist", SANDBOX_TARBALL_NAME);
  const pack = spawnSync("tar", ["-czf", tarballPath, "-C", staging, "package"], { encoding: "utf8" });
  rmSync(staging, { recursive: true, force: true });
  assert.equal(pack.status, 0, `fixture release tarball packing failed: ${pack.stderr}`);
  assert.ok(existsSync(tarballPath), "fixture release tarball was not created");
  return tarballPath;
}

/**
 * @brief Lists the launcher private run directories currently present in the OS temp root.
 * @details Used to prove PRJ-027 cleanup without assuming an empty global temp directory.
 * @return {string[]} Sorted matching directory basenames.
 */
function listLauncherRunDirs(): string[] {
  return readdirSync(tmpdir())
    .filter((entry) => entry.startsWith("mcp-google-api-run."))
    .sort();
}

/**
 * @brief Snapshot of every `dist` entry with its bytes, proving PRJ-025/PRJ-026 invariance.
 * @param sandbox {string} Sandbox repository root.
 * @return {Map<string, string>} Entry basename to hex content (directories mapped to `<dir>`).
 */
function snapshotDistDir(sandbox: string): Map<string, string> {
  const distDir = join(sandbox, "dist");
  const snapshot = new Map<string, string>();
  if (!existsSync(distDir)) {
    return snapshot;
  }
  for (const entry of readdirSync(distDir).sort()) {
    const entryPath = join(distDir, entry);
    try {
      snapshot.set(entry, readFileSync(entryPath).toString("hex"));
    } catch {
      snapshot.set(entry, "<dir>");
    }
  }
  return snapshot;
}

/**
 * @brief Runs the sandboxed launcher with argument forwarding and an observable exit code.
 * @param sandbox {string} Sandbox repository root.
 * @param args {readonly string[]} Arguments forwarded to the launched CLI.
 * @param exitCode {number} Fixture bundle exit code.
 * @return {{ status: number | null; stdout: string; stderr: string }} Captured child outcome.
 */
function runLauncher(
  sandbox: string,
  args: readonly string[],
  exitCode: number,
): { status: number | null; stdout: string; stderr: string } {
  const scriptPath = join(sandbox, SCRIPT_RELATIVE_PATH);
  const result = spawnSync("bash", [scriptPath, ...args], {
    cwd: sandbox,
    encoding: "utf8",
    timeout: SANDBOX_TIMEOUT_MS,
    env: { ...process.env, [EXIT_CODE_ENV]: String(exitCode) },
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

test("test_launcher_declares_ordered_bundle_sources_and_no_mutating_dist_writes", () => {
  // PRJ-019/PRJ-024/PRJ-029: compiler branch precedes the release-tarball branch, both precede abort;
  // PRJ-025/PRJ-026: no executable statement writes to or removes a dist entry; no implicit install.
  // Arrange
  const script = loadLauncherScript();
  const compilerBranch = script.indexOf('if [ -x "$COMPILER_BIN" ]; then');
  const tarballBranch = script.indexOf('elif [ -f "$RELEASE_TARBALL" ]; then');
  const abortBranch = script.indexOf("no runtime bundle source available");
  const extraction = script.indexOf('tar -xzOf "$RELEASE_TARBALL"');
  const executable = script
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");

  // Act + Assert
  assert.ok(compilerBranch >= 0, "compiler-preferred branch is missing (PRJ-019)");
  assert.ok(tarballBranch > compilerBranch, "release-tarball fallback must follow the compiler branch (PRJ-029)");
  assert.ok(abortBranch > tarballBranch, "dual-source abort must follow both bundle sources (PRJ-024)");
  assert.ok(extraction > tarballBranch, "release-tarball extraction statement is missing (PRJ-029)");
  assert.doesNotMatch(executable, /(^|\n)\s*npm (ci|install)\b/m, "launcher must stay install-free (PKG-019)");
  assert.doesNotMatch(executable, /rm -rf .*dist/, "launcher must not remove dist entries (PRJ-025)");
  assert.doesNotMatch(executable, />\s*"\$RELEASE_TARBALL"/, "launcher must not write the release tarball (PRJ-025)");
});

test("test_launcher_prefers_compiler_bundle_and_forwards_arguments", () => {
  // PRJ-019/PRJ-022: compiler path wins when both sources exist; args and exit code propagate.
  // Arrange
  const sandbox = createSandbox();
  try {
    writeCompilerStub(sandbox);
    const tarballPath = writeReleaseTarball(sandbox);
    const tarballBefore = readFileSync(tarballPath);
    const distBefore = snapshotDistDir(sandbox);
    const runDirsBefore = listLauncherRunDirs();
    const args = ["--stdio", "arg with space"];

    // Act
    const run = runLauncher(sandbox, args, 7);

    // Assert
    assert.equal(run.status, 7, `expected propagated exit code 7, got ${run.status}: ${run.stderr}`);
    const lines = run.stdout.trimEnd().split("\n");
    assert.equal(lines[0], `${SOURCE_MARKER_PREFIX}compiler`, "compiler-preferred bundle was not launched (PRJ-019)");
    assert.deepEqual(JSON.parse(lines[1]), args, "arguments were not forwarded unchanged (PRJ-022)");
    assert.deepEqual(snapshotDistDir(sandbox), distBefore, "compiler path modified dist/ (PRJ-025, PRJ-026)");
    assert.deepEqual(readFileSync(tarballPath), tarballBefore, "compiler path modified the release tarball (PRJ-025)");
    assert.deepEqual(listLauncherRunDirs(), runDirsBefore, "temporary build directory survived (PRJ-027)");
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("test_launcher_falls_back_to_committed_release_tarball", () => {
  // PRJ-029/PRJ-022: without the compiler the packed bundle is extracted and launched unchanged.
  // Arrange
  const sandbox = createSandbox();
  try {
    const tarballPath = writeReleaseTarball(sandbox);
    const tarballBefore = readFileSync(tarballPath);
    const distBefore = snapshotDistDir(sandbox);
    const runDirsBefore = listLauncherRunDirs();
    const args = ["--ver"];

    // Act
    const run = runLauncher(sandbox, args, 3);

    // Assert
    assert.equal(run.status, 3, `expected propagated exit code 3, got ${run.status}: ${run.stderr}`);
    const lines = run.stdout.trimEnd().split("\n");
    assert.equal(lines[0], `${SOURCE_MARKER_PREFIX}release-tarball`, "release-tarball fallback was not launched (PRJ-029)");
    assert.deepEqual(JSON.parse(lines[1]), args, "arguments were not forwarded unchanged (PRJ-022)");
    assert.deepEqual(snapshotDistDir(sandbox), distBefore, "fallback modified dist/ (PRJ-025, PRJ-026)");
    assert.deepEqual(readFileSync(tarballPath), tarballBefore, "fallback modified the release tarball (PRJ-025)");
    assert.deepEqual(listLauncherRunDirs(), runDirsBefore, "temporary build directory survived (PRJ-027)");
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("test_launcher_materializes_packaged_skills_root_for_bundle_commands", () => {
  // PRJ-018/PKG-024: the private temporary package root must expose the repository skills payload,
  // so `show` and the install-kind commands resolve `<packageRoot>/skills` instead of aborting.
  // Arrange
  const sandbox = createSandbox();
  try {
    writeSkillsFixture(sandbox);
    writeCompilerStub(sandbox, skillsProbeBundle("compiler"));
    const distBefore = snapshotDistDir(sandbox);
    const runDirsBefore = listLauncherRunDirs();

    // Act
    const run = runLauncher(sandbox, ["show"], 0);

    // Assert
    assert.equal(run.status, 0, `bundle could not resolve the packaged skills root: ${run.stderr}`);
    assert.match(run.stdout, /launcher-source=compiler:skills=1/, "packaged skills payload was not materialized (PKG-024)");
    assert.deepEqual(snapshotDistDir(sandbox), distBefore, "skills materialization modified dist/ (PRJ-025, PRJ-026)");
    assert.deepEqual(listLauncherRunDirs(), runDirsBefore, "temporary build directory survived (PRJ-027)");
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("test_launcher_aborts_naming_both_missing_bundle_sources", () => {
  // PRJ-024: no compiler and no release tarball -> non-zero abort naming both sources + remediation.
  // Arrange
  const sandbox = createSandbox();
  try {
    const distBefore = snapshotDistDir(sandbox);
    const runDirsBefore = listLauncherRunDirs();

    // Act
    const run = runLauncher(sandbox, ["--help"], 0);

    // Assert
    assert.notEqual(run.status, 0, "launcher must abort without any bundle source (PRJ-024)");
    assert.match(run.stderr, /node_modules[/\\]\.bin[/\\]tsup/, "diagnostic must name the missing compiler (PRJ-024)");
    assert.match(run.stderr, new RegExp(SANDBOX_TARBALL_NAME.replace(/\./g, "\\.")), "diagnostic must name the missing release tarball (PRJ-024)");
    assert.match(run.stderr, /npm ci/, "diagnostic must list the manual remediation commands (PRJ-024)");
    assert.match(run.stderr, /npm run build/, "diagnostic must list the manual remediation commands (PRJ-024)");
    assert.equal(run.stdout, "", "abort must not write bundle output to stdout");
    assert.deepEqual(snapshotDistDir(sandbox), distBefore, "abort path modified dist/ (PRJ-025, PRJ-026)");
    assert.deepEqual(listLauncherRunDirs(), runDirsBefore, "abort path left a temporary directory behind (PRJ-027)");
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
