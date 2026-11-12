/**
 * @fileoverview Release build script contract suite for the standalone runtime-bundle generator.
 *
 * @brief Guards `scripts/build.sh`: obsolete-build cleanup, single-bundle generation, artifact
 * verification, and the no-tarball/no-work-directory final state.
 * @details UUT: the tracked shell script plus a sandboxed execution in a private temporary
 * directory where the compiler is replaced by a stub that emits `dist/cli.js`. Level 0 (static
 * assertions over the tracked script) plus level 1 sandboxed child-process runs.
 * Enforced contract (PKG mapping):
 * - No npm tarball is ever created, moved, or retained inside `dist/` (PKG-102).
 * - After generation and verification every `*.tsbuildinfo` / `*.tmp` file is removed and the
 *   private work directory is deleted (PKG-108).
 * - `dist/` holds no artifact beyond `dist/cli.js`, and a surviving work directory fails the run
 *   (PKG-109).
 * - Preflight requires the compiler binary without installing dependencies, and any failing phase
 *   aborts non-zero naming the phase (PKG-067, PKG-068, PKG-073).
 * - Generation runs through the `build` npm script and yields the single runtime bundle
 *   (PKG-069, PKG-129).
 * @note Deterministic: tracked-file reads plus offline child runs bounded by explicit timeouts.
 * @satisfies PKG-067, PKG-068, PKG-069, PKG-073, PKG-102, PKG-108, PKG-109, PKG-129, TST-031
 */
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root resolved from this suite location (cwd-independent). */
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Repository-relative path of the tracked build script under test. */
const SCRIPT_RELATIVE_PATH = "scripts/build.sh";

/** Single runtime bundle produced by the build (PKG-069). */
const RUNTIME_BUNDLE = "cli.js";

/** Sandbox script basename kept so the copy resolves the sandbox as its repository root. */
const SANDBOX_SCRIPT_BASENAME = "build.sh";

/** Upper bound in milliseconds for one sandboxed build run. */
const SANDBOX_TIMEOUT_MS = 120000;

/**
 * @brief Loads the tracked build script.
 * @details Synchronous read of the repository-root script; parse-free raw text. Complexity
 * O(file size).
 * @return {string} Raw script content.
 * @throws {Error} When the script is missing or unreadable.
 */
function loadBuildScript(): string {
  return readFileSync(join(PROJECT_ROOT, SCRIPT_RELATIVE_PATH), "utf8");
}

/**
 * @brief Creates one sandbox repository hosting the tracked build script and a stub compiler.
 * @details Writes `scripts/build.sh`, a minimal `package.json` whose `build` script runs a stub
 * that emits `dist/cli.js`, an executable `node_modules/.bin/tsup` marker required by the
 * preflight, and optional seeded `dist/` entries. Complexity O(bundle size); the caller MUST
 * remove the returned directory.
 * @param seed {Record<string, string>} Relative paths mapped to the seeded file content.
 * @param compilerExitCode {number} Exit code of the stub `build` npm script.
 * @return {string} Absolute sandbox directory.
 */
function createSandbox(seed: Record<string, string>, compilerExitCode: number): string {
  const sandbox = mkdtempSync(join(tmpdir(), "release-build-script-"));
  mkdirSync(join(sandbox, "scripts"), { recursive: true });
  mkdirSync(join(sandbox, "node_modules", ".bin"), { recursive: true });
  writeFileSync(join(sandbox, "scripts", SANDBOX_SCRIPT_BASENAME), loadBuildScript(), { mode: 0o755 });
  writeFileSync(
    join(sandbox, "package.json"),
    JSON.stringify({ name: "release-build-fixture", version: "1.2.3", scripts: { build: "node ./emit-bundle.mjs" } }, null, 2),
    "utf8",
  );
  writeFileSync(
    join(sandbox, "emit-bundle.mjs"),
    [
      'import { mkdirSync, writeFileSync } from "node:fs";',
      'mkdirSync("dist", { recursive: true });',
      'writeFileSync("dist/cli.js", "console.log(\\"fixture\\");\\n");',
      `process.exit(${compilerExitCode});`,
      "",
    ].join("\n"),
    "utf8",
  );
  const compilerMarker = join(sandbox, "node_modules", ".bin", "tsup");
  writeFileSync(compilerMarker, "#!/usr/bin/env node\n", "utf8");
  chmodSync(compilerMarker, 0o755);
  for (const [relativePath, content] of Object.entries(seed)) {
    const absolute = join(sandbox, relativePath);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content, "utf8");
  }
  return sandbox;
}

/**
 * @brief Runs the sandboxed build script.
 * @details Spawns `bash scripts/build.sh` with the sandbox as working directory, capturing both
 * streams for diagnostics assertions. Complexity O(script runtime).
 * @param sandbox {string} Absolute sandbox directory.
 * @return {{ status: number | null, stdout: string, stderr: string }} Captured run outcome.
 */
function runBuildScript(sandbox: string): { status: number | null; stdout: string; stderr: string } {
  const run = spawnSync("bash", [join("scripts", SANDBOX_SCRIPT_BASENAME)], {
    cwd: sandbox,
    encoding: "utf8",
    timeout: SANDBOX_TIMEOUT_MS,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { status: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? "" };
}

test("test_build_script_never_creates_a_tarball_archive", () => {
  // PKG-102: packing is the release workflow's job; the build script only compiles.
  // Arrange
  const script = loadBuildScript();
  // Act
  const statements = script
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
  // Assert
  assert.equal(/npm\s+pack/.test(statements), false, "build.sh must not run npm pack (PKG-102)");
  assert.equal(/\btar\b/.test(statements), false, "build.sh must not handle tar archives (PKG-102)");
  assert.equal(statements.includes("dist/<name>-<version>.tgz"), false, "build.sh must not name a dist archive (PKG-102)");
});

test("test_build_script_requires_the_compiler_without_installing_dependencies", () => {
  // PKG-067/PKG-068: the compiler preflight aborts, and no install or publication ever runs.
  // Arrange
  const script = loadBuildScript();
  const statements = script
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
  // Assert
  assert.equal(
    statements.includes('if [ ! -x "node_modules/.bin/tsup" ]'),
    true,
    "build.sh must preflight the installed compiler (PKG-067)",
  );
  for (const forbidden of ["npm ci", "npm install", "npm publish", "npx "]) {
    assert.equal(statements.includes(forbidden), false, `build.sh must not run "${forbidden}" (PKG-068)`);
  }
  assert.equal(statements.includes('npm run build'), true, "build.sh must generate through the build script (PKG-069)");
});

test("test_sandboxed_build_leaves_the_single_bundle_and_no_archive", () => {
  // PKG-069/PKG-102/PKG-108/PKG-109: cleanup prunes stale generated outputs, the compile emits
  // dist/cli.js only, no *.tgz appears, non-generated entries survive, and the work directory is
  // removed.
  // Arrange
  const sandbox = createSandbox(
    {
      "dist/chunk-OLDHASH.js": "export const stale = 1;\n",
      "dist/older-0.0.1.tgz": "stale archive\n",
      "dist/stale.tsbuildinfo": "{}\n",
      "dist/keep.txt": "non-generated\n",
    },
    0,
  );
  try {
    // Act
    const run = runBuildScript(sandbox);
    const distEntries = readdirSync(join(sandbox, "dist")).sort();
    // Assert
    assert.equal(run.status, 0, `sandboxed build must succeed; stderr: ${run.stderr}`);
    assert.deepEqual(distEntries, [RUNTIME_BUNDLE, "keep.txt"], "dist/ must hold only the bundle and non-generated entries");
    assert.equal(existsSync(join(sandbox, "dist", "chunk-OLDHASH.js")), false, "stale generated output must be removed");
    assert.equal(existsSync(join(sandbox, "dist", "older-0.0.1.tgz")), false, "no archive may survive in dist/ (PKG-102)");
    assert.equal(existsSync(join(sandbox, "dist", "stale.tsbuildinfo")), false, "intermediate artifacts must be removed");
    assert.equal(run.stdout.includes("temporary work directory removed"), true, "the private work directory must be removed (PKG-108)");
    assert.equal(run.stdout.includes("SUCCESS"), true, "a passing build must report success (PKG-074)");
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("test_sandboxed_build_aborts_non_zero_when_the_compiler_fails", () => {
  // PKG-073: a failing compile phase aborts naming the phase and exits non-zero.
  // Arrange
  const sandbox = createSandbox({}, 4);
  try {
    // Act
    const run = runBuildScript(sandbox);
    // Assert
    assert.notEqual(run.status, 0, "a failing compile must exit non-zero (PKG-073)");
    assert.equal(run.stderr.includes("FAILED"), true, "the failing phase must be reported on stderr (PKG-073)");
    assert.equal(run.stderr.includes("compile"), true, "the diagnostic must name the failing phase (PKG-073)");
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
