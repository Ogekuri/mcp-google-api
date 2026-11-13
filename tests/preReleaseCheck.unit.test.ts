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
 * @satisfies PKG-058, PKG-059, PKG-060, PKG-061, PKG-062, PKG-080, PKG-081, PKG-123, PKG-124, PKG-140,
 *            PKG-141, PKG-142, PKG-143, PKG-144, PKG-145, PKG-019, TST-024, TST-038
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { delimiter, dirname, join } from "node:path";

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

/** Remediation command that restores the missing toolchain binaries (PKG-081, PKG-140). */
const DEPENDENCY_INSTALL_COMMAND = "npm ci";

/** Dependency binaries the preflight validates and the `npm` stub materializes (PKG-081, PKG-144). */
const TOOLCHAIN_BINARIES: readonly string[] = ["tsc", "tsup", "tsx"];

/** Statement proving the opt-in provisioning is disabled by default (PKG-141). */
const PROVISION_DEFAULT_STATEMENT = "PROVISION_TOOLCHAIN=0";

/** Guard statement that keeps the provisioning step off unless `--install` was parsed (PKG-141). */
const PROVISION_GUARD_STATEMENT = 'if [ "$PROVISION_TOOLCHAIN" -ne 1 ]';

/** Directory name of the PATH-injected `npm` stub inside a sandbox. */
const STUB_BIN_DIRNAME = "stubbin";

/** Marker file recording every `npm` invocation performed inside a sandbox. */
const NPM_INVOCATION_MARKER = "npm-invocations.log";

/**
 * @brief Collects executable statements that invoke a dependency install or publication command.
 * @details A command runs only in command position: every executable line is trimmed, leading shell
 * keywords and negations are stripped, and the remainder is matched against the `npm install`,
 * `npm ci`, `npm publish`, and `npx` prefixes. Command text that merely appears inside a diagnostic
 * string literal — for example the PKG-081 remediation hint printed by
 * `report_missing_prerequisites` — is not an invocation, so the PKG-141 guard inspects real
 * executions only.
 * @param script {string} Raw script content.
 * @return {string[]} Executable statements occupying command position; empty when nothing installs.
 * @note Complexity O(lines). Pure.
 * @satisfies PKG-141
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
 * @details Creates a unique temp directory, initializes it as a git work tree so the PKG-083
 * precondition holds, copies the tracked script content under `<sandbox>/scripts/` so the copy
 * resolves the sandbox as its repository root, and injects the given stage lines immediately before
 * the first release-gating stage. Complexity O(file size); the caller MUST remove the returned
 * directory.
 * @param injectedLines {readonly string[]} Stage lines inserted before the first release-gating stage.
 * @return {{ dir: string; scriptPath: string }} Sandbox directory and script path.
 * @throws {Error} When the sandbox cannot be initialized as a git work tree.
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
  const init = spawnSync("git", ["init", "-q"], { cwd: dir, encoding: "utf8", timeout: SANDBOX_TIMEOUT_MS });
  if (init.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`could not initialize the sandbox git work tree: ${init.stderr ?? ""}`);
  }
  return { dir, scriptPath };
}

/**
 * @brief Installs an offline `npm` stub into a sandbox and returns its PATH directory.
 * @details The stub logs every invocation into `<sandbox>/npm-invocations.log`; on a zero exit status
 * it also materializes the three toolchain binaries under `<sandbox>/node_modules/.bin/`, emulating a
 * successful `npm ci`. Prepending the returned directory to `PATH` keeps sandbox provisioning
 * deterministic, offline, and observable (PKG-141, PKG-142, PKG-144).
 * @param sandboxDir {string} Sandbox root directory.
 * @param exitCode {number} Exit status the stub reports.
 * @return {string} Absolute directory to prepend to `PATH`.
 */
function writeStubNpm(sandboxDir: string, exitCode: number): string {
  const stubDir = join(sandboxDir, STUB_BIN_DIRNAME);
  const binDir = join(sandboxDir, "node_modules", ".bin");
  mkdirSync(stubDir, { recursive: true });
  const lines = [
    "#!/bin/sh",
    `printf '%s\\n' "$*" >>"${join(sandboxDir, NPM_INVOCATION_MARKER)}"`,
  ];
  if (exitCode === 0) {
    lines.push(`mkdir -p "${binDir}"`);
    for (const binary of TOOLCHAIN_BINARIES) {
      const binaryPath = join(binDir, binary);
      lines.push(`printf '#!/bin/sh\\nexit 0\\n' >"${binaryPath}"`);
      lines.push(`chmod +x "${binaryPath}"`);
    }
  }
  lines.push(`exit ${exitCode}`, "");
  const stubPath = join(stubDir, "npm");
  writeFileSync(stubPath, lines.join("\n"), "utf8");
  chmodSync(stubPath, 0o755);
  return stubDir;
}

/**
 * @brief Runs one sandbox copy of the script with an optional PATH-prefixed stub directory.
 * @details Executes the script offline under the sandbox working directory and captures both streams,
 * so assertions never depend on the host toolchain beyond `bash`, `git`, `node`, `diff`, and `cmp`
 * (PKG-140..PKG-145).
 * @param sandbox {{ dir: string; scriptPath: string }} Sandbox returned by `writeSandboxScript`.
 * @param args {readonly string[]} Script arguments.
 * @param stubDir {string | undefined} Directory prepended to `PATH`; omitted when unused.
 * @return {{ status: number | null; stdout: string; stderr: string }} Captured child outcome.
 */
function runSandboxScript(
  sandbox: { dir: string; scriptPath: string },
  args: readonly string[],
  stubDir?: string,
): { status: number | null; stdout: string; stderr: string } {
  const basePath = process.env.PATH ?? "";
  const run = spawnSync("bash", [sandbox.scriptPath, ...args], {
    encoding: "utf8",
    timeout: SANDBOX_TIMEOUT_MS,
    cwd: sandbox.dir,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PATH: stubDir ? `${stubDir}${delimiter}${basePath}` : basePath },
  });
  return { status: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? "" };
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

/**
 * @brief Static proof that dependency install runs only through the opt-in `--install` step.
 * @details Asserts that the pipeline carries exactly one command-position install invocation, that it
 * is the `npm ci` provisioning command, that it sits behind the `PROVISION_TOOLCHAIN` guard which
 * defaults to 0, and that no `npm publish`, `npm install`, or `npx` invocation exists anywhere
 * (PKG-060, PKG-140, PKG-141, PKG-145). Pure string analysis; no filesystem or process access.
 * @satisfies PKG-060, PKG-140, PKG-141, PKG-145, TST-038
 */
test("test_pre_release_check_installs_only_through_the_opt_in_flag", () => {
  // PKG-140/PKG-141: provisioning is the single install path and it is opt-in.
  // Arrange
  const script = loadPreReleaseCheckScript();
  // Act
  const invocations = installInvocations(script);
  const guardIndex = script.indexOf(PROVISION_GUARD_STATEMENT);
  const invocationIndex = script.indexOf(`${DEPENDENCY_INSTALL_COMMAND};`);
  // Assert
  const expected_output = {
    invocations: 1,
    onlyNpmCi: true,
    defaultDisabled: true,
    guardBeforeInvocation: true,
    publicationFree: true,
  };
  assert.equal(invocations.length, expected_output.invocations);
  assert.equal(
    invocations.every((line) => line.includes(DEPENDENCY_INSTALL_COMMAND)),
    expected_output.onlyNpmCi,
    "the only dependency install must be the npm ci provisioning command (PKG-140)",
  );
  assert.equal(script.includes(PROVISION_DEFAULT_STATEMENT), expected_output.defaultDisabled);
  assert.equal(
    guardIndex >= 0 && invocationIndex > guardIndex,
    expected_output.guardBeforeInvocation,
    "npm ci must sit behind the PROVISION_TOOLCHAIN guard (PKG-141)",
  );
  assert.equal(
    invocations.some((line) => /npm\s+(?:install|publish)\b|npx\s/.test(line)),
    !expected_output.publicationFree,
    "no npm install and no package publication may run (PKG-060, PKG-141)",
  );
});

/**
 * @brief Sandbox proof that the default invocation performs no dependency install.
 * @details Runs a script copy with a PATH-injected `npm` stub that records every invocation and would
 * create the toolchain binaries on success, then asserts the stub was never called, the run aborts
 * non-zero on the missing binaries, and the skipped-provisioning hint is logged (PKG-141). The
 * sandbox is offline and removed afterwards.
 * @satisfies PKG-141, TST-038
 */
test("test_pre_release_check_default_mode_runs_no_dependency_install", () => {
  // PKG-141: without --install the gate must not execute any dependency install.
  // Arrange
  const sandbox = writeSandboxScript([]);
  const stubDir = writeStubNpm(sandbox.dir, 0);
  try {
    // Act
    const run = runSandboxScript(sandbox, [], stubDir);
    const npmInvoked = existsSync(join(sandbox.dir, NPM_INVOCATION_MARKER));
    // Assert
    const expected_output = { status: 1, npmInvoked: false, skipLogged: true, binariesNamed: true };
    assert.equal(run.status, expected_output.status);
    assert.equal(npmInvoked, expected_output.npmInvoked, "the default gate must not run npm (PKG-141)");
    assert.equal(run.stdout.includes("provisioning: skipped"), expected_output.skipLogged);
    assert.equal(
      run.stderr.includes(`node_modules/.bin/${TOOLCHAIN_BINARIES[0]}`),
      expected_output.binariesNamed,
      "the default gate must still name the missing binaries (PKG-081)",
    );
  } finally {
    rmSync(sandbox.dir, { recursive: true, force: true });
  }
});

/**
 * @brief Sandbox proof that `--install` provisions the toolchain and keeps the baseline intact.
 * @details Runs a script copy with `--install`, a PATH-injected `npm` stub that materializes the three
 * toolchain binaries, and an injected failing stage. Asserts that `npm ci` was the single install
 * invocation, provisioning is reported, no binary is reported missing afterwards, the provisioned
 * untracked tree never trips the integrity comparison because the snapshot is recorded afterwards,
 * and the run still aborts at the injected stage (PKG-140, PKG-142, PKG-143, PKG-144).
 * @satisfies PKG-140, PKG-142, PKG-143, PKG-144, TST-038
 */
test("test_pre_release_check_install_flag_provisions_the_toolchain", () => {
  // PKG-140/PKG-142/PKG-143/PKG-144: opt-in provisioning precedes validation and the snapshot.
  // Arrange
  const sandbox = writeSandboxScript([SANDBOX_INJECTED_STAGE_LINE]);
  const stubDir = writeStubNpm(sandbox.dir, 0);
  try {
    // Act
    const run = runSandboxScript(sandbox, ["--install"], stubDir);
    const invocations = readFileSync(join(sandbox.dir, NPM_INVOCATION_MARKER), "utf8").trim().split("\n");
    // Assert
    const expected_output = {
      status: 1,
      invocations: ["ci"],
      provisioningReported: true,
      missingReported: false,
      integrityHeld: true,
      failedPhase: 'RESULT: FAILED in phase "injected failure"',
    };
    assert.equal(run.status, expected_output.status);
    assert.deepEqual(invocations, expected_output.invocations);
    assert.equal(run.stdout.includes("provisioning: npm ci completed"), expected_output.provisioningReported);
    assert.equal(run.stderr.includes("MISSING:"), expected_output.missingReported);
    assert.equal(
      run.stdout.includes("repository state differs") || run.stderr.includes("repository state differs"),
      !expected_output.integrityHeld,
      "provisioning must not change the integrity baseline (PKG-143)",
    );
    assert.equal(run.stdout.includes(expected_output.failedPhase), true);
  } finally {
    rmSync(sandbox.dir, { recursive: true, force: true });
  }
});

/**
 * @brief Sandbox proof that a failing `npm ci` aborts the run in the provisioning phase.
 * @details Runs a script copy with `--install` and a `npm` stub exiting 7, then asserts a non-zero
 * status, the FAILED `provisioning` phase result line, and that no release-gating stage executed
 * (PKG-142).
 * @satisfies PKG-142, TST-038
 */
test("test_pre_release_check_install_flag_aborts_when_provisioning_fails", () => {
  // PKG-142: a failing npm ci terminates the run before the first stage.
  // Arrange
  const sandbox = writeSandboxScript([]);
  const stubDir = writeStubNpm(sandbox.dir, 7);
  try {
    // Act
    const run = runSandboxScript(sandbox, ["--install"], stubDir);
    // Assert
    const expected_output = {
      status: 1,
      failedPhase: 'RESULT: FAILED in phase "provisioning"',
      diagnostic: "npm ci exited non-zero",
      stageRan: false,
    };
    assert.equal(run.status, expected_output.status);
    assert.equal(run.stdout.includes(expected_output.failedPhase), true);
    assert.equal(run.stderr.includes(expected_output.diagnostic), true);
    assert.equal(run.stdout.includes("publish-version guard"), expected_output.stageRan);
  } finally {
    rmSync(sandbox.dir, { recursive: true, force: true });
  }
});

/**
 * @brief Sandbox proof that unsupported arguments are rejected before any prerequisite work.
 * @details Runs a script copy with an unsupported token and asserts a non-zero status, the `usage`
 * FAILED phase result line naming the offending argument, and that no `npm` child was spawned
 * (PKG-145).
 * @satisfies PKG-145, TST-038
 */
test("test_pre_release_check_rejects_unsupported_arguments", () => {
  // PKG-145: only the explicit --install flag is accepted.
  // Arrange
  const sandbox = writeSandboxScript([]);
  const stubDir = writeStubNpm(sandbox.dir, 0);
  try {
    // Act
    const run = runSandboxScript(sandbox, ["--force"], stubDir);
    const npmInvoked = existsSync(join(sandbox.dir, NPM_INVOCATION_MARKER));
    // Assert
    const expected_output = {
      status: 1,
      usagePhase: 'RESULT: FAILED in phase "usage"',
      namesArgument: "unsupported argument: --force",
      npmInvoked: false,
    };
    assert.equal(run.status, expected_output.status);
    assert.equal(run.stdout.includes(expected_output.usagePhase), true);
    assert.equal(run.stderr.includes(expected_output.namesArgument), true);
    assert.equal(npmInvoked, expected_output.npmInvoked);
  } finally {
    rmSync(sandbox.dir, { recursive: true, force: true });
  }
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
