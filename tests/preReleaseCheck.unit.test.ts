/**
 * @fileoverview Pre-release check contract suite for `scripts/pre-release-check.sh`.
 *
 * @brief Guards the release-gating pipeline script declared by PKG-058: stage
 * inventory and order, fail-fast abort wiring, repository-root execution, and the
 * no-install/no-publication constraint.
 * @details UUT: the tracked shell script `scripts/pre-release-check.sh` itself plus a
 * sandboxed fail-fast execution against a temp-dir copy. Enforced contract: the script
 * declares exactly the four release-gating stages in mandatory order — publish-version
 * guard (`npm run check:publish-version`), typecheck (`npm run typecheck`), unit tests
 * (`npm test`), production build (`npm run build`) — with the PKG-057/PKG-017 version
 * guard first (PKG-059); the fail-fast shell wiring (`set -euo pipefail`, `exit 1` on
 * the first failed stage) is present; the script changes into the repository root
 * resolved from its own location; and no dependency install or package publication
 * command appears anywhere (PKG-060). The sandbox run injects a failing first stage
 * into a temp-dir copy and asserts exit code 1 with zero passing stages, proving
 * fail-fast behavior at runtime (TST-024); further sandbox runs prove artifact
 * hygiene: a `dist` directory created during the run is removed even on the
 * fail-fast path (PKG-061) while a pre-existing `dist` directory is preserved
 * untouched (PKG-062). Deterministic: every static input is a
 * tracked, immutable-at-test-time repository file; the sandbox run is offline, bounded
 * by an explicit timeout, and writes only under the OS temp directory.
 * @note HDT level 0 (atomic) for the static contract tests; the sandbox fail-fast test
 * isolates its only external interaction (one `bash` child on a temp-dir script copy).
 * @satisfies PKG-058, PKG-059, PKG-060, PKG-061, PKG-062, PKG-019, TST-024
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PROJECT_ROOT: string = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT_RELATIVE_PATH = "scripts/pre-release-check.sh";

/** Release-gating stages in mandatory execution order (PKG-059). */
const REQUIRED_STAGE_LINES: readonly string[] = [
  "run_stage 'publish-version guard' npm run check:publish-version",
  "run_stage 'typecheck' npm run typecheck",
  "run_stage 'unit tests' npm test",
  "run_stage 'build' npm run build",
];

/** Commands that MUST NOT appear anywhere in the script (PKG-060). */
const FORBIDDEN_COMMANDS: readonly string[] = ["npm install", "npm ci", "npm publish", "npx "];

/** Stage label injected as the first (failing) stage in the sandbox run. */
const SANDBOX_INJECTED_STAGE_LINE = "run_stage 'injected failure' false";

/** Stage line creating the build artifact directory inside the sandbox (PKG-061). */
const SANDBOX_ARTIFACT_STAGE_LINE = "run_stage 'create artifact' mkdir -p dist";

/** Basename the sandbox copy keeps so the script resolves the sandbox as repository root. */
const SANDBOX_SCRIPT_BASENAME = "pre-release-check.sh";

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
  // PKG-058/PKG-059: all four release-gating stages declared, version guard first, fixed order.
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

test("test_pre_release_check_never_installs_or_publishes", () => {
  // PKG-060: no dependency install and no package publication anywhere in the pipeline.
  // Arrange
  const script = loadPreReleaseCheckScript();
  // Act
  const forbiddenHits = FORBIDDEN_COMMANDS.filter((forbidden) => script.includes(forbidden));
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
      timeout: 30000,
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
 * @brief Sandbox proof that an artifact directory created by the run is removed on failure.
 * @details Injects an artifact-creating stage followed by a failing stage into a temp-dir
 * script copy and asserts fail-fast exit 1 with the sandbox `dist` directory removed by
 * the EXIT trap (PKG-061). Deterministic: offline child run, bounded timeout, temp-dir
 * only; no repository file is touched.
 * @satisfies PKG-061, PKG-059, TST-024
 */
test("test_pre_release_check_sandbox_removes_artifact_created_by_run", () => {
  // PKG-061: a dist directory the run creates is removed even on the fail-fast path.
  // Arrange
  const sandbox = writeSandboxScript([SANDBOX_ARTIFACT_STAGE_LINE, SANDBOX_INJECTED_STAGE_LINE]);
  const artifactDir = join(sandbox.dir, "dist");
  try {
    // Act
    const run = spawnSync("bash", [sandbox.scriptPath], {
      encoding: "utf8",
      timeout: 30000,
      cwd: sandbox.dir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Assert
    const expected_output = { status: 1, artifactRemoved: false };
    assert.equal(run.status, expected_output.status);
    assert.equal(existsSync(artifactDir), expected_output.artifactRemoved);
  } finally {
    rmSync(sandbox.dir, { recursive: true, force: true });
  }
});

/**
 * @brief Sandbox proof that a pre-existing artifact directory is preserved untouched.
 * @details Seeds a `dist` directory with a sentinel file before running a temp-dir script
 * copy with an injected failing stage, then asserts fail-fast exit 1 with the sentinel
 * byte-identical, proving the pre-run snapshot keeps pre-existing artifacts (PKG-062).
 * Deterministic: offline child run, bounded timeout, temp-dir only; no repository file
 * is touched.
 * @satisfies PKG-062, PKG-059, TST-024
 */
test("test_pre_release_check_sandbox_preserves_preexisting_artifact", () => {
  // PKG-062: a dist directory present before the run is preserved untouched.
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
      timeout: 30000,
      cwd: sandbox.dir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Assert
    const expected_output = { status: 1, sentinelPreserved: "pre-existing" };
    assert.equal(run.status, expected_output.status);
    assert.equal(readFileSync(sentinelPath, "utf8"), expected_output.sentinelPreserved);
  } finally {
    rmSync(sandbox.dir, { recursive: true, force: true });
  }
});
