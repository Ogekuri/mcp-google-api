/**
 * @file Static contract suite for the GitHub Actions release workflow contract.
 * @details UUT: the tracked workflow YAML contract itself (`.github/workflows/release-npm.yml`)
 * plus the enforced absence of the removed CI workflow (`.github/workflows/ci.yml`) — the
 * behavior contract IS the file content, so the suite reads the tracked, immutable inputs
 * directly. Level 0 (atomic static assertions; no internal call-graph dependencies).
 * External dependencies to isolate: none beyond `node:fs` reads of repository-tracked files
 * (deterministic by design; no network, no clock, no environment dependence).
 *
 * Contract under test (PKG mapping):
 * - The CI automation is removed: `.github/workflows/ci.yml` MUST NOT exist; the
 *   development-phase minimum verification stays available as local npm commands on the
 *   developer platform only (`npm run typecheck`, `npm test`, `npm run verify` per PKG-019).
 * - The release workflow is the only GitHub Actions workflow: triggered by a canonical
 *   version tag (PKG-008, PKG-029), one integrated job (PKG-027) gated on a tagged commit
 *   reachable from master (PKG-009), failing before any install/build/pack/publish step
 *   otherwise (PKG-028). Build and pack run exclusively here (PKG-026); the pipeline
 *   defines NO typecheck, unit-test, verify, or smoke-check step (release-time testing
 *   removed; PKG-019 keeps the minimum verification local). The npm release pipeline is
 *   defined in `.github/workflows/release-npm.yml` (PKG-029).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CI_WORKFLOW_PATH = join(PROJECT_ROOT, ".github", "workflows", "ci.yml");
const RELEASE_WORKFLOW_PATH = join(PROJECT_ROOT, ".github", "workflows", "release-npm.yml");

/**
 * @brief Loads a GitHub Actions workflow definition as text for contract assertions.
 * @details Read once per test; workflow files are tracked, immutable inputs
 * during the test run, so caching is unnecessary. Missing files fail the test.
 * @param absolutePath {string} Absolute workflow file path.
 * @return {string} Raw YAML text of the workflow file.
 * @throws {Error} When the workflow file does not exist or cannot be read.
 */
function readWorkflow(absolutePath: string): string {
  return readFileSync(absolutePath, "utf-8");
}

test("CI workflow automation is removed from the repository", () => {
  // CI automation removed: the development-phase minimum verification runs
  // locally via npm commands (PKG-019) on the developer platform; no
  // push/PR workflow file may exist.
  const expected_output = false;
  assert.equal(existsSync(CI_WORKFLOW_PATH), expected_output);
});

test("Release workflow is triggered only by a canonical version tag push", () => {
  // PKG-008: tag-only trigger matching v<major>.<minor>.<patch>; branch pushes
  // (including master) and pull requests never trigger the release workflow.
  const workflow = readWorkflow(RELEASE_WORKFLOW_PATH);
  assert.equal(workflow.includes("tags:"), true);
  assert.equal(workflow.includes("'v[0-9]+.[0-9]+.[0-9]+'"), true);
});

test("Release workflow gates the single integrated job on the tagged master commit", () => {
  // PKG-009/PKG-027/PKG-028: exactly one release job hosts the branch gate,
  // build, pack, and publish. No separate or parallel release jobs exist, and
  // the gate command precedes every dependency install, build, pack, and
  // publish step, so a tag not reachable from origin/master (e.g. a tag on
  // develop) fails before anything builds.
  const workflow = readWorkflow(RELEASE_WORKFLOW_PATH);
  assert.equal(workflow.includes("check-branch:"), false);
  assert.equal(workflow.includes("needs: check-branch"), false);
  assert.equal(workflow.includes("git branch -r --contains ${GITHUB_SHA} | grep -q \"origin/master\""), true);
  const gateIdx = workflow.indexOf("git branch -r --contains");
  const installIdx = workflow.indexOf("run: npm ci");
  const buildIdx = workflow.indexOf("run: npm run build");
  const packIdx = workflow.indexOf("run: npm pack");
  const publishIdx = workflow.indexOf("run: npm publish --provenance --access public");
  assert.notEqual(installIdx, -1);
  assert.notEqual(buildIdx, -1);
  assert.notEqual(packIdx, -1);
  assert.notEqual(publishIdx, -1);
  assert.equal(gateIdx < installIdx, true);
  assert.equal(gateIdx < buildIdx, true);
  assert.equal(gateIdx < packIdx, true);
  assert.equal(gateIdx < publishIdx, true);
});

test("Release workflow defines no typecheck, unit-test, verify, or smoke-check step", () => {
  // Release-time testing removed: the release pipeline builds, packs, and
  // publishes without running typecheck, unit tests, the verify pipeline,
  // or the installed-package doctor smoke check. The development-phase
  // minimum verification stays local (PKG-019); PKG-026 keeps build/pack
  // exclusive to this workflow.
  const workflow = readWorkflow(RELEASE_WORKFLOW_PATH);
  assert.equal(workflow.includes("run: npm run typecheck"), false);
  assert.equal(workflow.includes("run: npm test"), false);
  assert.equal(workflow.includes("run: npm run verify"), false);
  assert.equal(workflow.includes("run: npm run test:e2e"), false);
  assert.equal(workflow.includes("run: mcp-google-map doctor"), false);
  assert.equal(workflow.includes("GOOGLE_MAPS_API_KEY: release-smoke-placeholder-key"), false);
});

test("Release workflow publishes with provenance and attaches the packed tarball", () => {
  // PKG-010/PKG-012: publish uses provenance attestation and public access;
  // the release asset is the packed npm tarball, failing on unmatched files;
  // the tarball is packed before the release step attaches it.
  const workflow = readWorkflow(RELEASE_WORKFLOW_PATH);
  const packIdx = workflow.indexOf("run: npm pack");
  const releaseIdx = workflow.indexOf("files: mcp-google-map-*.tgz");
  assert.notEqual(releaseIdx, -1);
  assert.equal(workflow.includes("run: npm publish --provenance --access public"), true);
  assert.equal(workflow.includes("fail_on_unmatched_files: true"), true);
  assert.equal(packIdx < releaseIdx, true);
});
