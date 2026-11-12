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
 *   version tag (PKG-008, PKG-029), one integrated job (PKG-027) whose first release step
 *   resolves the tagged commit's reachability from origin/master and origin/develop into step
 *   outputs (PKG-009), failing before any artifact resolution, publish, or release-creation
 *   step when neither branch contains the tag (PKG-028).
 * - The release job consumes the locally prepared artifact: it runs no dependency install, no
 *   build, no pack, and no verification script (PKG-110), and resolves
 *   `dist/mcp-google-api-<version>.tgz` from the tagged commit through `git cat-file`
 *   after rejecting a missing or empty file (PKG-111).
 * - npm publish runs only for master-reachable tags (PKG-042); develop-only tags create the
 *   GitHub Release with the committed tarball without publishing (PKG-043). Publishing
 *   authenticates via npm OIDC Trusted Publishing (PKG-010): `id-token: write` granted
 *   (PKG-030), no NPM_TOKEN secret or NODE_AUTH_TOKEN variable referenced (PKG-031), publish
 *   step on the pinned Node.js runtime bundling npm >= 11.5.1 (PKG-032).
 * - The published package and the GitHub Release asset are exactly the committed tarball
 *   (PKG-012, PKG-113, PKG-126, PKG-128), without any repack.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CI_WORKFLOW_PATH = join(PROJECT_ROOT, ".github", "workflows", "ci.yml");
const RELEASE_WORKFLOW_PATH = join(PROJECT_ROOT, ".github", "workflows", "release-npm.yml");

/** Commands that would install, build, pack, or run local gates in release automation (PKG-110). */
const FORBIDDEN_WORKFLOW_TOKENS = [
  "run: npm ci",
  "run: npm install",
  "run: npm run build",
  "run: npm run typecheck",
  "run: npm test",
  "run: npm run verify",
  "run: npm run test:e2e",
  "run: npm pack",
  "run: node tools/check-release-artifacts.mjs",
  "run: mcp-google-api doctor",
  "scripts/build.sh",
  "scripts/pre-release-check.sh",
];

/** Resolved pre-built release artifact path output of the resolution step (PKG-110, PKG-111). */
const ARTIFACT_PATH_OUTPUT = "${{ steps.prebuilt.outputs.artifact_path }}";

/** Publish command consuming the committed tarball (PKG-113). */
const PUBLISH_COMMAND = `run: npm publish "${ARTIFACT_PATH_OUTPUT}" --ignore-scripts --provenance --access public`;

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
  // PKG-009/PKG-027/PKG-028: exactly one release job hosts the branch gate and the
  // pre-built artifact resolution. No separate or parallel release jobs exist. The gate
  // fetches both branches, resolves the tagged commit's reachability from origin/master
  // and origin/develop, exports both outcomes, and fails before any artifact resolution,
  // publish, or release-creation step when neither branch contains the tag.
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
  const resolveIdx = workflow.indexOf("git cat-file -e \"${GITHUB_SHA}:${artifact}\"");
  const publishIdx = workflow.indexOf(PUBLISH_COMMAND);
  const releaseAssetIdx = workflow.indexOf(`files: ${ARTIFACT_PATH_OUTPUT}`);
  for (const [name, index] of [
    ["gate", gateIdx],
    ["pre-built artifact resolution", resolveIdx],
    ["publish", publishIdx],
    ["release asset", releaseAssetIdx],
  ] as const) {
    assert.notEqual(index, -1, `release workflow must contain the ${name} step`);
  }
  assert.equal(gateIdx < resolveIdx, true);
  assert.equal(gateIdx < publishIdx, true);
  assert.equal(gateIdx < releaseAssetIdx, true);
  assert.equal(resolveIdx < publishIdx, true, "the artifact must be resolved before publication (PKG-111)");
  assert.equal(resolveIdx < releaseAssetIdx, true, "the artifact must be resolved before release creation (PKG-111)");
});

test("Release workflow consumes the pre-built artifact and runs no build or pack", () => {
  // PKG-110/PKG-111: automation resolves the committed tarball and verifies it belongs to the
  // tagged commit; it never installs dependencies, builds, packs, or runs a verification script.
  const workflow = readWorkflow(RELEASE_WORKFLOW_PATH);
  const leftovers = FORBIDDEN_WORKFLOW_TOKENS.filter((token) => workflow.includes(token));
  assert.deepEqual(leftovers, []);
  assert.equal(workflow.includes("artifact=\"dist/mcp-google-api-${version}.tgz\""), true);
  assert.equal(workflow.includes("if [ ! -s \"${artifact}\" ]"), true);
  assert.equal(workflow.includes("git cat-file -e \"${GITHUB_SHA}:${artifact}\""), true);
  assert.equal(workflow.includes("artifact_path=${artifact}"), true);
  assert.equal(workflow.includes("artifact_name=$(basename \"${artifact}\")"), true);
});

test("Release workflow publishes to npm only for master-reachable tags", () => {
  // PKG-042/PKG-043/PKG-113: the publish step is the only step conditioned on the
  // branch-gate master output, so develop-only tags skip exactly npm publication while the
  // pre-built artifact resolution, changelog, and GitHub Release with the tarball asset still run.
  const workflow = readWorkflow(RELEASE_WORKFLOW_PATH);
  const condition = "steps.branch_gate.outputs.on_master == 'true'";
  const gateOutputIdx = workflow.indexOf("on_master=${on_master}");
  const publishIfIdx = workflow.indexOf(`if: ${condition}`);
  const publishRunIdx = workflow.indexOf(PUBLISH_COMMAND);
  const releaseAssetIdx = workflow.indexOf(`files: ${ARTIFACT_PATH_OUTPUT}`);
  const conditionCount = workflow.split(`if: ${condition}`).length - 1;
  assert.equal(gateOutputIdx !== -1, true);
  assert.equal(conditionCount, 1);
  assert.notEqual(publishIfIdx, -1);
  assert.notEqual(publishRunIdx, -1);
  assert.equal(publishIfIdx < publishRunIdx, true);
  assert.equal(gateOutputIdx < publishIfIdx, true);
  assert.notEqual(releaseAssetIdx, -1);
});

test("Release workflow publishes via npm OIDC Trusted Publishing and attaches the committed tarball", () => {
  // PKG-010/PKG-012/PKG-030/PKG-031/PKG-032/PKG-126/PKG-128: publish uses OIDC Trusted
  // Publishing with provenance attestation and public access on the pinned Node.js runtime,
  // references no publish-token secret or variable, and attaches exactly the committed tarball
  // with a one-tarball asset-set check.
  const workflow = readWorkflow(RELEASE_WORKFLOW_PATH);
  const releaseIdx = workflow.indexOf(`files: ${ARTIFACT_PATH_OUTPUT}`);
  assert.notEqual(releaseIdx, -1);
  assert.equal(workflow.includes("id-token: write"), true);
  assert.equal(workflow.includes("secrets.NPM_TOKEN"), false);
  assert.equal(workflow.includes("NODE_AUTH_TOKEN"), false);
  assert.equal(workflow.includes(PUBLISH_COMMAND), true);
  assert.equal(workflow.includes("npm >= 11.5.1"), true);
  assert.equal(/^  NODE_VERSION: '24\./m.test(workflow), true);
  assert.equal(workflow.includes("fail_on_unmatched_files: true"), true);
  assert.equal(workflow.includes("generate_release_notes: false"), true);
  assert.equal(workflow.includes("find dist -maxdepth 1 -type f -name '*.tgz' -print | wc -l"), true);
  assert.equal(workflow.includes("Expected exactly one committed release tarball"), true);
});
