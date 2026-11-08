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
 * fail-fast behavior at runtime (TST-024). Deterministic: every static input is a
 * tracked, immutable-at-test-time repository file; the sandbox run is offline, bounded
 * by an explicit timeout, and writes only under the OS temp directory.
 * @note HDT level 0 (atomic) for the static contract tests; the sandbox fail-fast test
 * isolates its only external interaction (one `bash` child on a temp-dir script copy).
 * @satisfies PKG-058, PKG-059, PKG-060, PKG-019, TST-024
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  const sandboxDir = mkdtempSync(join(tmpdir(), "pre-release-check-"));
  const sandboxScriptPath = join(sandboxDir, "pre-release-check.sh");
  const script = loadPreReleaseCheckScript();
  const firstStageLine = REQUIRED_STAGE_LINES[0];
  const injectedScript = script.replace(
    firstStageLine,
    `${SANDBOX_INJECTED_STAGE_LINE}\n${firstStageLine}`,
  );
  writeFileSync(sandboxScriptPath, injectedScript, "utf8");
  try {
    // Act
    const run = spawnSync("bash", [sandboxScriptPath], {
      encoding: "utf8",
      timeout: 30000,
      cwd: sandboxDir,
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
    rmSync(sandboxDir, { recursive: true, force: true });
  }
});
