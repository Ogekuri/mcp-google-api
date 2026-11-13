/**
 * @fileoverview Pre-release check contract suite for `scripts/pre-release-check.sh`.
 *
 * @brief Guards the release-gating pipeline script declared by PKG-058: stage
 * inventory and order, fail-fast abort wiring, temporary-directory build output, complete
 * independence from the repository `dist/` directory, and the no-install/no-publication constraint.
 * @details UUT: the tracked shell script `scripts/pre-release-check.sh` itself plus sandboxed runs
 * against temp-dir copies. Enforced contract: the script declares exactly the five release-gating
 * stages in mandatory order — publish-version guard (`npm run check:publish-version`), typecheck
 * (`npm run typecheck`), unit tests (`npm test`), temporary-directory build, and temporary-artifact
 * verification — with the PKG-057/PKG-017 version guard first (PKG-059); the fail-fast shell wiring
 * (`set -euo pipefail`, `exit 1` on the first failed stage) is present; the script changes into the
 * repository root resolved from its own location; no dependency install or package publication
 * command appears anywhere (PKG-060); every test-build output is directed into a private temporary
 * directory proven to live outside the repository working tree (PKG-061); and no executable
 * statement reads, lists, compares, validates, creates, modifies, or deletes any repository `dist/`
 * entry, `scripts/build.sh` invocation, or `tools/check-release-artifacts.mjs` invocation
 * (PKG-062, PKG-123, PKG-124).
 * @note HDT level 0 (atomic) for the static contract tests; the sandbox tests isolate their only
 * external interaction (one offline `bash` child on a temp-dir script copy) and prove the outcome is
 * independent of the `dist/` state it seeds (populated or absent).
 * @satisfies PKG-058, PKG-059, PKG-060, PKG-061, PKG-062, PKG-080, PKG-081, PKG-123, PKG-124, PKG-019, TST-024
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PROJECT_ROOT: string = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT_RELATIVE_PATH = "scripts/pre-release-check.sh";

/** Release-gating stages in mandatory execution order (PKG-059, PKG-080). */
const REQUIRED_STAGE_LINES: readonly string[] = [
  "run_stage 'publish-version guard' npm run check:publish-version",
  "run_stage 'typecheck' npm run typecheck",
  "run_stage 'unit tests' npm test",
  "run_stage 'build' build_into_temp_dir",
  "run_stage 'artifact verification' verify_temp_build",
];

/** Remediation command that restores the missing toolchain binaries (PKG-081). */
const DEPENDENCY_INSTALL_COMMAND = "npm ci";

/**
 * @brief Collects executable statements that invoke a dependency install or publication command.
 * @details A command runs only in command position: every executable line is trimmed, leading shell
 * keywords and negations are stripped, and the remainder is matched against the `npm install`,
 * `npm ci`, `npm publish`, and `npx` prefixes. Command text that merely appears inside a diagnostic
 * string literal — for example the PKG-081 remediation hint printed by
 * `report_missing_prerequisites` — is not an invocation, so the PKG-060 guard keeps rejecting real
 * executions while allowing the failure message to name the operator's restore command.
 * @param script {string} Raw script content.
 * @return {string[]} Offending executable statements; empty when the pipeline never installs.
 * @note Complexity O(lines). Pure.
 * @satisfies PKG-060
 */
function installInvocations(script: string): string[] {
  const invocationPattern =
    /^(?:(?:if|then|else|elif|while|do)\s+|!\s+|\{\s+)*(?:npm\s+(?:ci|install|publish)\b|npx\s)/;
  return executableStatements(script)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => invocationPattern.test(line));
}

/** Tokens that MUST NOT appear in any executable statement (PKG-062, PKG-123, PKG-124). */
const FORBIDDEN_EXECUTABLE_TOKENS: readonly string[] = [
  "dist",
  "scripts/build.sh",
  "check-release-artifacts",
];

/** Statement proving the build output lands in the private temporary directory (PKG-061). */
const TEMP_BUILD_DIR_STATEMENT = 'BUILD_DIR="$WORKDIR/build"';

/** Statement directing the compiler output into the private temporary directory (PKG-061). */
const TEMP_BUILD_OUTPUT_STATEMENT = '--out-dir "$BUILD_DIR"';

/** Stage label injected as the first (failing) stage in the sandbox runs. */
const SANDBOX_INJECTED_STAGE_LINE = "run_stage 'injected failure' false";

/** Basename the sandbox copy keeps so the script resolves the sandbox as repository root. */
const SANDBOX_SCRIPT_BASENAME = "pre-release-check.sh";

/** Upper bound in milliseconds for one sandboxed script run. */
const SANDBOX_TIMEOUT_MS = 30000;

/**
 * @brief Loads the tracked pre-release check script.
 * @details Synchronous read of the repository-root script; parse-free raw text.
 * Complexity: O(file size).
 * @pre `scripts/pre-release-check.sh` exists at the repository root.
 * @return {string} Raw script content.
 * @throws {Error} When the script is missing or unreadable.
 */
function loadPreReleaseCheckScript(): string {
  return readFileSync(join(PROJECT_ROOT, SCRIPT_RELATIVE_PATH), "utf8");
}

/**
 * @brief Extracts the executable statements of the script, dropping comment-only lines.
 * @details Keeps every line whose first non-space character is not `#`, so Doxygen banners and
 * inline documentation never mask an executable reference. Complexity O(lines).
 * @param script {string} Raw script content.
 * @return {string} Executable statements joined with newlines.
 */
function executableStatements(script: string): string {
  return script
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
}

/**
 * @brief Writes one sandbox copy of the pre-release check script with injected stage lines.
 * @details Creates a unique temp directory, copies the tracked script content under
 * `<sandbox>/scripts/` so the copy resolves the sandbox as its repository root, and
 * injects the given stage lines immediately before the first release-gating stage.
 * Complexity O(file size); the caller MUST remove the returned directory.
 * @param injectedLines {readonly string[]} Stage lines inserted before the first release-gating stage.
 * @return {{ dir: string; scriptPath: string }} Sandbox directory and script path.
 */
function writeSandboxScript(injectedLines: readonly string[]): { dir: string; scriptPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "pre-release-check-"));
  const scriptPath = join(dir, "scripts", SANDBOX_SCRIPT_BASENAME);
  const firstStageLine = REQUIRED_STAGE_LINES[0];
  const injectedScript = loadPreReleaseCheckScript().replace(
    firstStageLine,
    `${injectedLines.join("\n")}\n${firstStageLine}`,
  );
  mkdirSync(dirname(scriptPath), { recursive: true });
  writeFileSync(scriptPath, injectedScript, "utf8");
  return { dir, scriptPath };
}

test("test_pre_release_check_declares_release_gating_stages_in_order", () => {
  // PKG-058/PKG-059/PKG-080: all five release-gating stages declared, version guard first, fixed order.
  // Arrange
  const script = loadPreReleaseCheckScript();
  // Act
  const stageOffsets = REQUIRED_STAGE_LINES.map((stageLine) => script.indexOf(stageLine));
  // Assert
  const expected_output = REQUIRED_STAGE_LINES.length;
  assert.equal(stageOffsets.filter((offset) => offset >= 0).length, expected_output);
  for (let index = 1; index < stageOffsets.length; index += 1) {
    assert.equal(
      stageOffsets[index] > stageOffsets[index - 1],
      true,
      `stage "${REQUIRED_STAGE_LINES[index]}" must run after "${REQUIRED_STAGE_LINES[index - 1]}" (PKG-059)`,
    );
  }
});

test("test_pre_release_check_aborts_at_first_failed_stage", () => {
  // PKG-059/PKG-060: fail-fast shell wiring — strict mode plus exit 1 on the first failed stage.
  // Arrange
  const script = loadPreReleaseCheckScript();
  // Act
  const hasStrictMode = script.includes("set -euo pipefail");
  const failureBranchIndex = script.indexOf("FAILED (exit");
  const failureExitIndex = failureBranchIndex >= 0 ? script.indexOf("exit 1", failureBranchIndex) : -1;
  // Assert
  const expected_output = { strict: true, failureExitAfterFailureBranch: true };
  assert.equal(hasStrictMode, expected_output.strict);
  assert.equal(failureExitIndex > failureBranchIndex, expected_output.failureExitAfterFailureBranch);
});

test("test_pre_release_check_runs_stages_from_repository_root", () => {
  // PKG-058: the pipeline must execute against the repository root regardless of caller cwd.
  // Arrange
  const script = loadPreReleaseCheckScript();
  // Act
  const resolvesRepoRootFromScriptLocation = script.includes('cd "$(dirname "$0")/.."');
  // Assert
  const expected_output = true;
  assert.equal(resolvesRepoRootFromScriptLocation, expected_output);
});

/**
 * @brief Sandbox proof that one preflight run names every missing toolchain prerequisite.
 * @details Runs a temp-dir script copy whose sandbox root carries no `node_modules/.bin` directory, so
 * the `tsc`, `tsup`, and `tsx` dependency binaries are all absent simultaneously, and asserts that the
 * single run reports each of them before aborting (PKG-081: validate the toolchain naming each missing
 * item). The fail-fast `require_binary` shape this test rejects named only the first absent binary,
 * forcing one rerun per missing prerequisite. Deterministic: offline `bash` child on a temp-dir copy,
 * bounded timeout, no repository `dist/` or `node_modules` dependence.
 * @satisfies PKG-081, TST-024
 */
test("test_pre_release_check_preflight_names_every_missing_prerequisite", () => {
  // PKG-081: every missing toolchain item must be named by a single preflight run.
  // Arrange
  const sandbox = writeSandboxScript([]);
  const expectedMissingBinaries: readonly string[] = ["tsc", "tsup", "tsx"];
  try {
    // Act
    const run = spawnSync("bash", [sandbox.scriptPath], {
      encoding: "utf8",
      timeout: SANDBOX_TIMEOUT_MS,
      cwd: sandbox.dir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stderr = run.stderr ?? "";
    // Assert
    const expected_output = { status: 1, unnamedBinaries: [] as string[] };
    assert.equal(run.status, expected_output.status);
    const unnamedBinaries = expectedMissingBinaries.filter(
      (binary) => !stderr.includes(`node_modules/.bin/${binary}`),
    );
    assert.deepEqual(unnamedBinaries, expected_output.unnamedBinaries);
  } finally {
    rmSync(sandbox.dir, { recursive: true, force: true });
  }
});

test("test_pre_release_check_preflight_names_the_toolchain_remediation", () => {
  // PKG-081: a toolchain-gate failure must name the command that restores the prerequisites.
  // Arrange
  const sandbox = writeSandboxScript([]);
  try {
    // Act
    const run = spawnSync("bash", [sandbox.scriptPath], {
      encoding: "utf8",
      timeout: SANDBOX_TIMEOUT_MS,
      cwd: sandbox.dir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stderr = run.stderr ?? "";
    // Assert
    const expected_output = { status: 1, namesInstallCommand: true };
    assert.equal(run.status, expected_output.status);
    assert.equal(
      stderr.includes(DEPENDENCY_INSTALL_COMMAND),
      expected_output.namesInstallCommand,
      `the preflight failure must name the remediation command "${DEPENDENCY_INSTALL_COMMAND}" (PKG-081)`,
    );
  } finally {
    rmSync(sandbox.dir, { recursive: true, force: true });
  }
});

test("test_pre_release_check_never_installs_or_publishes", () => {
  // PKG-060: no dependency install and no package publication is ever executed by the pipeline.
  // Arrange
  const script = loadPreReleaseCheckScript();
  // Act
  const forbiddenHits = installInvocations(script);
  // Assert
  const expected_output: string[] = [];
  assert.deepEqual(forbiddenHits, expected_output);
});

test("test_pre_release_check_builds_into_temporary_directory_outside_repository", () => {
  // PKG-061: the test build output directory is a private temp directory proven to be outside the repo.
  // Arrange
  const script = loadPreReleaseCheckScript();
  // Act
  const declaresTempBuildDir = script.includes(TEMP_BUILD_DIR_STATEMENT);
  const directsCompilerOutput = script.includes(TEMP_BUILD_OUTPUT_STATEMENT);
  const provesOutsideRepository = script.includes('is_outside_repository "$WORKDIR"');
  // Assert
  const expected_output = { declaresTempBuildDir: true, directsCompilerOutput: true, provesOutsideRepository: true };
  assert.deepEqual(
    { declaresTempBuildDir, directsCompilerOutput, provesOutsideRepository },
    expected_output,
  );
});

test("test_pre_release_check_executable_statements_reference_no_dist_entry", () => {
  // PKG-062/PKG-123/PKG-124: no executable statement creates, modifies, deletes, reads, or validates
  // any repository dist/ entry, and no dist-oriented release stage is invoked.
  // Arrange
  const script = loadPreReleaseCheckScript();
  // Act
  const statements = executableStatements(script);
  const forbiddenHits = FORBIDDEN_EXECUTABLE_TOKENS.filter((forbidden) => statements.includes(forbidden));
  // Assert
  const expected_output: string[] = [];
  assert.deepEqual(forbiddenHits, expected_output);
});

test("test_pre_release_check_sandbox_run_fails_fast_on_injected_failing_stage", () => {
  // PKG-059/PKG-060 (TST-024 runtime evidence): an injected first-stage failure stops the
  // pipeline with exit 1 before any later stage can pass.
  // Arrange
  const sandbox = writeSandboxScript([SANDBOX_INJECTED_STAGE_LINE]);
  try {
    // Act
    const run = spawnSync("bash", [sandbox.scriptPath], {
      encoding: "utf8",
      timeout: SANDBOX_TIMEOUT_MS,
      cwd: sandbox.dir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Assert
    const expected_output = { status: 1, passesEmitted: false, failureReported: true };
    assert.equal(run.status, expected_output.status);
    assert.equal(
      (run.stdout ?? "").includes("PASS"),
      expected_output.passesEmitted,
      "no later stage may pass after the first failed stage (PKG-059)",
    );
    assert.equal(
      (run.stderr ?? "").includes("FAILED"),
      expected_output.failureReported,
      "the failing stage must report FAILED on stderr (PKG-059)",
    );
  } finally {
    rmSync(sandbox.dir, { recursive: true, force: true });
  }
});

/**
 * @brief Sandbox proof that a populated `dist/` directory is never touched by the pipeline.
 * @details Seeds a `dist` directory with a sentinel file before running a temp-dir script copy with
 * an injected failing stage, then asserts fail-fast exit 1 with the sentinel byte-identical and the
 * directory listing unchanged, proving complete independence from a populated `dist/` (PKG-062,
 * PKG-124). Deterministic: offline child run, bounded timeout, temp-dir only.
 * @satisfies PKG-062, PKG-124, PKG-059, TST-024
 */
test("test_pre_release_check_sandbox_preserves_populated_dist_untouched", () => {
  // PKG-062/PKG-124: a populated dist directory survives the run byte-identically.
  // Arrange
  const sandbox = writeSandboxScript([SANDBOX_INJECTED_STAGE_LINE]);
  const artifactDir = join(sandbox.dir, "dist");
  mkdirSync(artifactDir, { recursive: true });
  const sentinelPath = join(artifactDir, "pre-existing.marker");
  writeFileSync(sentinelPath, "pre-existing", "utf8");
  try {
    // Act
    const run = spawnSync("bash", [sandbox.scriptPath], {
      encoding: "utf8",
      timeout: SANDBOX_TIMEOUT_MS,
      cwd: sandbox.dir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Assert
    const expected_output = { status: 1, sentinel: "pre-existing", entries: ["pre-existing.marker"] };
    assert.equal(run.status, expected_output.status);
    assert.equal(readFileSync(sentinelPath, "utf8"), expected_output.sentinel);
    assert.deepEqual(readdirSync(artifactDir), expected_output.entries);
  } finally {
    rmSync(sandbox.dir, { recursive: true, force: true });
  }
});

/**
 * @brief Sandbox proof that the pipeline outcome is independent of an absent `dist/` directory.
 * @details Runs a temp-dir script copy without any `dist` directory and asserts fail-fast exit 1 with
 * no `dist` directory created afterwards (PKG-062, PKG-124). Deterministic: offline child run,
 * bounded timeout, temp-dir only.
 * @satisfies PKG-062, PKG-124, PKG-059, TST-024
 */
test("test_pre_release_check_sandbox_never_creates_dist", () => {
  // PKG-062/PKG-124: an absent dist directory stays absent after the run.
  // Arrange
  const sandbox = writeSandboxScript([SANDBOX_INJECTED_STAGE_LINE]);
  const artifactDir = join(sandbox.dir, "dist");
  try {
    // Act
    const run = spawnSync("bash", [sandbox.scriptPath], {
      encoding: "utf8",
      timeout: SANDBOX_TIMEOUT_MS,
      cwd: sandbox.dir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Assert
    const expected_output = { status: 1, artifactCreated: false };
    assert.equal(run.status, expected_output.status);
    assert.equal(existsSync(artifactDir), expected_output.artifactCreated);
  } finally {
    rmSync(sandbox.dir, { recursive: true, force: true });
  }
});
