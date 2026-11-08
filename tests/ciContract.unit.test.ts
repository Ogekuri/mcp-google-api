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
 *   version tag (PKG-008, PKG-029), one integrated job (PKG-027) whose first step resolves
 *   the tagged commit's reachability from origin/master and origin/develop into step
 *   outputs (PKG-009), failing before any install/build/pack/publish step when neither
 *   branch contains the tag (PKG-028). Build and pack run exclusively here (PKG-026); the
 *   pipeline defines no direct typecheck, unit-test, verify, or smoke-check command — all
 *   test stages live inside the PKG-063 pre-release gate step running
 *   `scripts/pre-release-check.sh` (publish-version guard + typecheck + unit tests +
 *   build, fail-fast per PKG-059), placed after the branch gate and `npm ci` and before
 *   every build, pack, publish, and release-creation step, so failing stages block
 *   artifact creation and publication. The npm release
 *   pipeline is defined in `.github/workflows/release-npm.yml` (PKG-029). npm publish runs
 *   only for master-reachable tags (PKG-042); develop-only tags build, pack, and create
 *   the GitHub Release with the tarball asset without publishing (PKG-043). Publishing
 *   authenticates via npm OIDC Trusted Publishing (PKG-010): `id-token: write` granted
 *   (PKG-030), no NPM_TOKEN secret or NODE_AUTH_TOKEN variable referenced (PKG-031),
 *   publish step runs on the pinned Node.js runtime bundling npm >= 11.5.1 (PKG-032).
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

test("Release workflow gates the single integrated job on master and develop tag reachability", () => {
  // PKG-009/PKG-027/PKG-028: exactly one release job hosts the branch gate,
  // build, pack, and publish. No separate or parallel release jobs exist.
  // The gate fetches both branches, resolves the tagged commit's
  // reachability from origin/master and origin/develop, exports both
  // outcomes, and fails before any dependency install, build, pack, or
  // publish step when neither branch contains the tag.
  const workflow = readWorkflow(RELEASE_WORKFLOW_PATH);
  assert.equal(workflow.includes("check-branch:"), false);
  assert.equal(workflow.includes("needs: check-branch"), false);
  assert.equal(workflow.includes("git fetch origin master develop"), true);
  assert.equal(workflow.includes("git branch -r --contains ${GITHUB_SHA} | grep -q \"origin/master\""), true);
  assert.equal(workflow.includes("git branch -r --contains ${GITHUB_SHA} | grep -q \"origin/develop\""), true);
  assert.equal(workflow.includes("reachable from neither origin/master nor origin/develop"), true);
  assert.equal(workflow.includes("on_master=${on_master}"), true);
  assert.equal(workflow.includes("on_develop=${on_develop}"), true);
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

test("Release workflow publishes to npm only for master-reachable tags", () => {
  // PKG-042/PKG-043: the publish step is the only step conditioned on the
  // branch-gate master output, so develop-only tags skip exactly npm
  // publication while build, pack, changelog, and the GitHub Release with
  // the tarball asset still run.
  const workflow = readWorkflow(RELEASE_WORKFLOW_PATH);
  const condition = "steps.branch_gate.outputs.on_master == 'true'";
  const gateOutputIdx = workflow.indexOf("on_master=${on_master}");
  const publishIfIdx = workflow.indexOf(`if: ${condition}`);
  const publishRunIdx = workflow.indexOf("run: npm publish --provenance --access public");
  const releaseAssetIdx = workflow.indexOf("files: mcp-google-api-*.tgz");
  const conditionCount = workflow.split(`if: ${condition}`).length - 1;
  const expected_output = {
    gateExportsMasterOutput: true,
    masterConditionCount: 1,
    publishConditionBeforeCommand: true,
    publishConditionAfterGate: true,
    releaseAssetStepPresent: true,
  };
  assert.equal(gateOutputIdx !== -1, expected_output.gateExportsMasterOutput);
  assert.equal(conditionCount, expected_output.masterConditionCount);
  assert.equal(publishIfIdx !== -1, expected_output.publishConditionBeforeCommand);
  assert.notEqual(publishRunIdx, -1);
  assert.equal(publishIfIdx < publishRunIdx, true);
  assert.equal(gateOutputIdx < publishIfIdx, expected_output.publishConditionAfterGate);
  assert.equal(releaseAssetIdx !== -1, expected_output.releaseAssetStepPresent);
});

test("Release workflow gates build, pack, publish, and release on the pre-release check", () => {
  // PKG-063: the pipeline defines no direct typecheck/unit-test/verify/smoke
  // commands — all test stages live inside the gate script — and the gate step
  // runs scripts/pre-release-check.sh after the branch gate and dependency
  // installation, before every build, pack, publish, and release-creation
  // step, so failing stages block artifact creation and publication.
  const workflow = readWorkflow(RELEASE_WORKFLOW_PATH);
  const gateIdx = workflow.indexOf("run: bash scripts/pre-release-check.sh");
  const installIdx = workflow.indexOf("run: npm ci");
  const buildIdx = workflow.indexOf("run: npm run build");
  const packIdx = workflow.indexOf("run: npm pack");
  const publishIdx = workflow.indexOf("run: npm publish --provenance --access public");
  const releaseAssetIdx = workflow.indexOf("files: mcp-google-api-*.tgz");
  const expected_output = {
    gateStepPresent: true,
    gateAfterInstall: true,
    gateBeforeBuild: true,
    gateBeforePack: true,
    gateBeforePublish: true,
    gateBeforeReleaseAsset: true,
    directTypecheckCommandAbsent: false,
    directTestCommandAbsent: false,
    directVerifyCommandAbsent: false,
    directE2eCommandAbsent: false,
    directDoctorCommandAbsent: false,
  };
  assert.notEqual(gateIdx, -1);
  assert.notEqual(installIdx, -1);
  assert.notEqual(buildIdx, -1);
  assert.notEqual(packIdx, -1);
  assert.notEqual(publishIdx, -1);
  assert.notEqual(releaseAssetIdx, -1);
  assert.equal(gateIdx > installIdx, expected_output.gateAfterInstall);
  assert.equal(gateIdx < buildIdx, expected_output.gateBeforeBuild);
  assert.equal(gateIdx < packIdx, expected_output.gateBeforePack);
  assert.equal(gateIdx < publishIdx, expected_output.gateBeforePublish);
  assert.equal(gateIdx < releaseAssetIdx, expected_output.gateBeforeReleaseAsset);
  assert.equal(workflow.includes("run: npm run typecheck"), expected_output.directTypecheckCommandAbsent);
  assert.equal(workflow.includes("run: npm test"), expected_output.directTestCommandAbsent);
  assert.equal(workflow.includes("run: npm run verify"), expected_output.directVerifyCommandAbsent);
  assert.equal(workflow.includes("run: npm run test:e2e"), expected_output.directE2eCommandAbsent);
  assert.equal(workflow.includes("run: mcp-google-api doctor"), expected_output.directDoctorCommandAbsent);
});

test("Release workflow publishes via npm OIDC Trusted Publishing and attaches the packed tarball", () => {
  // PKG-010/PKG-012: publish uses OIDC Trusted Publishing with provenance
  // attestation and public access; the release asset is the packed npm
  // tarball, failing on unmatched files; the tarball is packed before the
  // release step attaches it.
  // PKG-030/PKG-031/PKG-032: the publish step authenticates via the GitHub
  // Actions OIDC token (`id-token: write`), references no NPM_TOKEN secret
  // and no NODE_AUTH_TOKEN variable, and runs on the pinned Node.js runtime
  // bundling npm >= 11.5.1 (OIDC Trusted Publishing floor).
  const workflow = readWorkflow(RELEASE_WORKFLOW_PATH);
  const packIdx = workflow.indexOf("run: npm pack");
  const releaseIdx = workflow.indexOf("files: mcp-google-api-*.tgz");
  const expected_output = {
    oidcPermissionGranted: true,
    npmTokenSecretReferenced: false,
    nodeAuthTokenVariableReferenced: false,
    publishCommandPresent: true,
    trustedPublishingFloorDocumented: true,
    pinnedNodeMajor24: true,
    releaseAssetPatternPresent: true,
    tarballPackedBeforeRelease: true,
  };
  assert.notEqual(releaseIdx, -1);
  assert.equal(workflow.includes("id-token: write"), expected_output.oidcPermissionGranted);
  assert.equal(workflow.includes("secrets.NPM_TOKEN"), expected_output.npmTokenSecretReferenced);
  assert.equal(workflow.includes("NODE_AUTH_TOKEN"), expected_output.nodeAuthTokenVariableReferenced);
  assert.equal(workflow.includes("run: npm publish --provenance --access public"), expected_output.publishCommandPresent);
  assert.equal(workflow.includes("npm >= 11.5.1"), expected_output.trustedPublishingFloorDocumented);
  assert.equal(/^  NODE_VERSION: '24\./m.test(workflow), expected_output.pinnedNodeMajor24);
  assert.equal(workflow.includes("fail_on_unmatched_files: true"), expected_output.releaseAssetPatternPresent);
  assert.equal(packIdx < releaseIdx, expected_output.tarballPackedBeforeRelease);
});
