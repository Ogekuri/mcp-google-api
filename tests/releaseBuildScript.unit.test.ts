/**
 * @fileoverview Release build script contract suite for the standalone release-artifact generator.
 *
 * @brief Guards `scripts/build.sh`: version-aware obsolete-build cleanup that runs before the
 * compile, bundling, packing, artifact validation, bundle removal, and the final
 * tarball-only `dist/` state.
 * @details UUT: the tracked shell script plus sandboxed executions in a private temporary
 * directory where the compiler is replaced by a stub that emits `dist/cli.js` and the artifact
 * validator is replaced by a recorder stub. Level 0 (static assertions over the tracked script)
 * plus level 1 sandboxed child-process runs.
 * Enforced contract (PKG mapping):
 * - The obsolete-build cleanup runs strictly before the compile step (PKG-104, PKG-132).
 * - The cleanup removes every generated output of an earlier build and every `dist/` file whose
 *   path carries a `MAJOR.MINOR.PATCH` token differing from the `package.json` version, while
 *   preserving version-free non-generated entries (PKG-071, PKG-105, PKG-132).
 * - The release tarball `<package name>-<version>.tgz` is packed with `npm pack --ignore-scripts`
 *   directly into `dist/` (PKG-102).
 * - The packed tarball is validated through `tools/check-release-artifacts.mjs` before the
 *   compiled bundle is removed and success is reported (PKG-135).
 * - The compiled `dist/cli.js` bundle is removed after packing so `dist/` holds only the tarball
 *   (PKG-134, PKG-136).
 * - After generation and validation every `*.tsbuildinfo` / `*.tmp` file is removed and the
 *   private work directory is deleted (PKG-108).
 * - A foreign-version artifact that survives the compile aborts the run naming the entry
 *   (PKG-133), and any unexpected `dist/` entry aborts the final state check (PKG-109, PKG-134).
 * - Preflight requires the compiler binary without installing dependencies, and any failing phase
 *   aborts non-zero naming the phase (PKG-067, PKG-068, PKG-073).
 * - Generation runs through the `build` npm script and yields the single runtime bundle
 *   (PKG-069, PKG-129).
 * @note Deterministic: tracked-file reads plus offline child runs bounded by explicit timeouts.
 * @satisfies PKG-067, PKG-068, PKG-069, PKG-071, PKG-073, PKG-102, PKG-104, PKG-105, PKG-108,
 *            PKG-109, PKG-129, PKG-132, PKG-133, PKG-134, PKG-135, PKG-136, TST-031
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

/** Sandbox package name declaring the expected release tarball basename (PKG-102). */
const SANDBOX_NAME = "release-build-fixture";

/** Package version declared by the sandbox manifest; any other version is foreign (PKG-132). */
const SANDBOX_VERSION = "1.2.3";

/** Expected sandbox release tarball basename (PKG-102, PKG-134). */
const SANDBOX_TARBALL = `${SANDBOX_NAME}-${SANDBOX_VERSION}.tgz`;

/** Version token used by the seeded artifacts of an earlier release (PKG-132). */
const FOREIGN_VERSION = "0.9.9";

/** Sandbox script basename kept so the copy resolves the sandbox as its repository root. */
const SANDBOX_SCRIPT_BASENAME = "build.sh";

/** File the validator stub writes with the tarball path it received (PKG-135). */
const VALIDATOR_ARGS_FILE = "validator-args.txt";

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
 * @brief Returns the executable statements of the tracked build script.
 * @details Drops comment-only lines so Doxygen banners never satisfy or violate a statement
 * assertion. Pure; complexity O(lines).
 * @return {string} Executable statements joined with newlines.
 */
function executableStatements(): string {
  return loadBuildScript()
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
}

/**
 * @brief Creates one sandbox repository hosting the tracked build script, a stub compiler, and a
 * validator stub.
 * @details Writes `scripts/build.sh`, a minimal `package.json` whose `build` script runs a stub
 * that emits `dist/cli.js` plus the requested extra artifacts, an executable
 * `node_modules/.bin/tsup` marker required by the preflight, a `tools/check-release-artifacts.mjs`
 * recorder stub, and the seeded `dist/` entries. Complexity O(bundle size); the caller MUST
 * remove the returned directory.
 * @param seed {Record<string, string>} Relative paths mapped to the seeded file content.
 * @param compilerExitCode {number} Exit code of the stub `build` npm script.
 * @param emittedArtifacts {Record<string, string>} Extra relative paths written by the stub compiler.
 * @param validatorExitCode {number} Exit code of the validator stub.
 * @return {string} Absolute sandbox directory.
 */
function createSandbox(
  seed: Record<string, string>,
  compilerExitCode: number,
  emittedArtifacts: Record<string, string> = {},
  validatorExitCode = 0,
): string {
  const sandbox = mkdtempSync(join(tmpdir(), "release-build-script-"));
  const artifactWrites = Object.entries(emittedArtifacts).map(
    ([relativePath, content]) =>
      `mkdirSync(dirnameSync("${relativePath}"), { recursive: true });\nwriteFileSync("${relativePath}", ${JSON.stringify(content)});`,
  );
  mkdirSync(join(sandbox, "scripts"), { recursive: true });
  mkdirSync(join(sandbox, "tools"), { recursive: true });
  mkdirSync(join(sandbox, "node_modules", ".bin"), { recursive: true });
  writeFileSync(join(sandbox, "scripts", SANDBOX_SCRIPT_BASENAME), loadBuildScript(), { mode: 0o755 });
  writeFileSync(
    join(sandbox, "package.json"),
    JSON.stringify(
      {
        name: SANDBOX_NAME,
        version: SANDBOX_VERSION,
        files: ["dist"],
        scripts: { build: "node ./emit-bundle.mjs" },
      },
      null,
      2,
    ),
    "utf8",
  );
  writeFileSync(
    join(sandbox, "emit-bundle.mjs"),
    [
      'import { mkdirSync, writeFileSync } from "node:fs";',
      'import { dirname as dirnameSync } from "node:path";',
      'mkdirSync("dist", { recursive: true });',
      'writeFileSync("dist/cli.js", "console.log(\\"fixture\\");\\n");',
      ...artifactWrites,
      `process.exit(${compilerExitCode});`,
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    join(sandbox, "tools", "check-release-artifacts.mjs"),
    [
      'import { writeFileSync } from "node:fs";',
      `writeFileSync(${JSON.stringify(VALIDATOR_ARGS_FILE)}, process.argv[2] ?? "");`,
      `process.exit(${validatorExitCode});`,
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

test("test_build_script_runs_the_cleanup_before_the_compile", () => {
  // PKG-104/PKG-132: the obsolete-build cleanup is the phase preceding `npm run build`.
  // Arrange
  const statements = executableStatements();
  // Act
  const cleanupIndex = statements.indexOf('remove_classified_outputs is_obsolete_artifact "obsolete-files.lst" "cleanup"');
  const compileIndex = statements.indexOf("if ! npm run build");
  // Assert
  assert.notEqual(cleanupIndex, -1, "build.sh must run the obsolete-build cleanup through is_obsolete_artifact (PKG-104)");
  assert.notEqual(compileIndex, -1, "build.sh must invoke the build script (PKG-069)");
  assert.equal(cleanupIndex < compileIndex, true, "the cleanup must precede the compile (PKG-104, PKG-132)");
});

test("test_build_script_reads_the_package_identity_for_the_release_tarball", () => {
  // PKG-102/PKG-132/PKG-134: the release tarball name and the foreign-version classification need
  // the package name, the package version, and a version token scan.
  // Arrange
  const statements = executableStatements();
  // Act
  const readsName = statements.includes(`PACKAGE_NAME="$(node -p 'require("./package.json").name')"`);
  const readsVersion = statements.includes(`CURRENT_VERSION="$(node -p 'require("./package.json").version')"`);
  const derivesTarball = statements.includes('TARBALL_NAME="$PACKAGE_NAME-$CURRENT_VERSION.tgz"');
  const scansTokens = /\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+/.test(statements);
  // Assert
  assert.equal(readsName, true, "build.sh must read the package name before packing (PKG-102)");
  assert.equal(readsVersion, true, "build.sh must read the package version before the cleanup (PKG-132)");
  assert.equal(derivesTarball, true, "build.sh must derive the tarball name from name and version (PKG-102)");
  assert.equal(scansTokens, true, "build.sh must scan paths for MAJOR.MINOR.PATCH tokens (PKG-132)");
});

test("test_build_script_packs_validates_and_removes_the_bundle", () => {
  // PKG-102/PKG-135/PKG-136/PKG-134: packing happens through npm, the artifact validator runs on
  // the resulting tarball, the compiled bundle is removed afterwards, and the final check accepts
  // only the release tarball.
  // Arrange
  const statements = executableStatements();
  // Act
  const packIndex = statements.indexOf("npm pack --ignore-scripts --pack-destination");
  const validateIndex = statements.indexOf('node tools/check-release-artifacts.mjs "$TARBALL"');
  const removeIndex = statements.indexOf('rm -f -- "$DIST_DIR/$RUNTIME_BUNDLE"');
  const finalCheck = statements.includes('find "$DIST_DIR" -mindepth 1 -print0');
  // Assert
  for (const [name, index] of [
    ["pack", packIndex],
    ["validation", validateIndex],
    ["bundle removal", removeIndex],
  ] as const) {
    assert.notEqual(index, -1, `build.sh must run the ${name} step`);
  }
  assert.equal(packIndex < validateIndex, true, "the tarball must be packed before validation (PKG-135)");
  assert.equal(validateIndex < removeIndex, true, "the bundle must be removed only after validation (PKG-136)");
  assert.equal(finalCheck, true, "the final phase must verify the exact dist/ state (PKG-134)");
});

test("test_build_script_requires_the_compiler_without_installing_dependencies", () => {
  // PKG-067/PKG-068: the compiler preflight aborts, and no install or publication ever runs.
  // Arrange
  const statements = executableStatements();
  // Assert
  assert.equal(
    statements.includes('if [ ! -x "node_modules/.bin/tsup" ]'),
    true,
    "build.sh must preflight the installed compiler (PKG-067)",
  );
  for (const forbidden of ["npm ci", "npm install", "npm publish", "npx "]) {
    assert.equal(statements.includes(forbidden), false, `build.sh must not run "${forbidden}" (PKG-068)`);
  }
  assert.equal(statements.includes("npm run build"), true, "build.sh must generate through the build script (PKG-069)");
});

test("test_sandboxed_build_leaves_only_the_validated_release_tarball", () => {
  // PKG-071/PKG-102/PKG-105/PKG-108/PKG-109/PKG-132/PKG-134/PKG-135/PKG-136: cleanup prunes stale
  // generated outputs and foreign-version artifacts, the compile emits dist/cli.js, the tarball is
  // packed and validated, the bundle is removed, and dist/ ends up holding only the tarball.
  // Arrange
  const sandbox = createSandbox(
    {
      "dist/chunk-OLDHASH.js": "export const stale = 1;\n",
      "dist/older-0.0.1.tgz": "stale archive\n",
      "dist/stale.tsbuildinfo": "{}\n",
      [`dist/snapshots/${FOREIGN_VERSION}/notes.md`]: "release notes of an earlier build\n",
      [`dist/legacy-${FOREIGN_VERSION}.txt`]: "version-stamped artifact of an earlier build\n",
    },
    0,
  );
  try {
    // Act
    const run = runBuildScript(sandbox);
    const distEntries = readdirSync(join(sandbox, "dist")).sort();
    // Assert
    assert.equal(run.status, 0, `sandboxed build must succeed; stderr: ${run.stderr}`);
    assert.deepEqual(distEntries, [SANDBOX_TARBALL], "dist/ must hold only the release tarball (PKG-134)");
    assert.equal(existsSync(join(sandbox, "dist", "chunk-OLDHASH.js")), false, "stale generated output must be removed");
    assert.equal(existsSync(join(sandbox, "dist", "older-0.0.1.tgz")), false, "obsolete archives must be removed");
    assert.equal(existsSync(join(sandbox, "dist", "stale.tsbuildinfo")), false, "intermediate artifacts must be removed");
    assert.equal(
      existsSync(join(sandbox, "dist", "snapshots", FOREIGN_VERSION)),
      false,
      "a foreign-version directory must be removed before the build (PKG-132)",
    );
    assert.equal(
      existsSync(join(sandbox, "dist", `legacy-${FOREIGN_VERSION}.txt`)),
      false,
      "a foreign-version file must be removed before the build (PKG-132)",
    );
    assert.equal(existsSync(join(sandbox, "dist", RUNTIME_BUNDLE)), false, "the compiled bundle must be removed (PKG-136)");
    assert.equal(
      readFileSync(join(sandbox, VALIDATOR_ARGS_FILE), "utf8"),
      join("dist", SANDBOX_TARBALL),
      "the validator must receive the packed tarball path (PKG-135)",
    );
    assert.equal(run.stdout.includes("temporary work directory removed"), true, "the private work directory must be removed (PKG-108)");
    assert.equal(run.stdout.includes(`${SANDBOX_NAME}@${SANDBOX_VERSION}`), true, "the build must report the version it targets (PKG-132)");
    assert.equal(run.stdout.includes("SUCCESS"), true, "a passing build must report success (PKG-074)");
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("test_sandboxed_build_aborts_when_the_artifact_validator_fails", () => {
  // PKG-135: a failing artifact validation aborts the build before success is reported.
  // Arrange
  const sandbox = createSandbox({}, 0, {}, 3);
  try {
    // Act
    const run = runBuildScript(sandbox);
    // Assert
    assert.notEqual(run.status, 0, "a failing artifact validation must fail the build (PKG-135)");
    assert.equal(run.stderr.includes("FAILED"), true, "the failure must be reported on stderr (PKG-073)");
    assert.equal(run.stderr.includes("artifact validation"), true, "the diagnostic must name the failing phase (PKG-135)");
    assert.equal(
      existsSync(join(sandbox, "dist", RUNTIME_BUNDLE)),
      true,
      "the bundle must survive a failed validation so the validator can inspect it (PKG-136)",
    );
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("test_sandboxed_build_aborts_on_an_unexpected_dist_entry", () => {
  // PKG-109/PKG-134: a version-free non-generated entry is preserved by the cleanup yet rejected
  // by the final exact-state check naming the offending entry.
  // Arrange
  const sandbox = createSandbox({ "dist/keep.txt": "non-generated\n" }, 0);
  try {
    // Act
    const run = runBuildScript(sandbox);
    // Assert
    assert.notEqual(run.status, 0, "an unexpected dist/ entry must fail the build (PKG-109, PKG-134)");
    assert.equal(run.stderr.includes("FAILED"), true, "the failure must be reported on stderr (PKG-073)");
    assert.equal(run.stderr.includes("keep.txt"), true, "the diagnostic must name the offending entry (PKG-134)");
    assert.equal(existsSync(join(sandbox, "dist", "keep.txt")), true, "version-free non-generated entries are never deleted (PKG-071)");
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("test_sandboxed_build_aborts_when_a_foreign_version_artifact_survives_the_compile", () => {
  // PKG-133: an artifact stamped with another release that the compile introduces aborts the run.
  // Arrange
  const sandbox = createSandbox({}, 0, {
    [`dist/release-${FOREIGN_VERSION}.txt`]: "emitted with a foreign version token\n",
  });
  try {
    // Act
    const run = runBuildScript(sandbox);
    // Assert
    assert.notEqual(run.status, 0, "a surviving foreign-version artifact must fail the build (PKG-133)");
    assert.equal(run.stderr.includes("FAILED"), true, "the failure must be reported on stderr (PKG-073)");
    assert.equal(run.stderr.includes(`release-${FOREIGN_VERSION}.txt`), true, "the diagnostic must name the offending entry (PKG-133)");
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
