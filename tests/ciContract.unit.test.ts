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
 *   outputs (PKG-009), failing before any install, build, pack, publish, or release-creation
 *   step when neither branch contains the tag (PKG-028).
 * - The release job builds the artifact: `npm ci` installs the locked tree and
 *   `npm run build` compiles the single runtime entry (PKG-110), then `npm pack
 *   --ignore-scripts` packs the freshly built tree without a second build (PKG-111). No
 *   repository build script, no pre-release gate script, no typecheck, and no unit-test stage
 *   appears in the workflow.
 * - The packed tarball is validated offline against the freshly built `dist/` tree through
 *   `tools/check-release-artifacts.mjs` before publication and release creation (PKG-113),
 *   and is attached as the GitHub Release asset (PKG-012).
 * - npm publish runs only for master-reachable tags (PKG-042); develop-only tags build, pack,
 *   validate, and create the GitHub Release with the tarball asset without publishing
 *   (PKG-043). Publishing authenticates via npm OIDC Trusted Publishing (PKG-010):
 *   `id-token: write` granted (PKG-030), no NPM_TOKEN secret or NODE_AUTH_TOKEN variable
 *   referenced (PKG-031), publish step runs on the pinned Node.js runtime bundling
 *   npm >= 11.5.1 (PKG-032).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CI_WORKFLOW_PATH = join(PROJECT_ROOT, ".github", "workflows", "ci.yml");
const RELEASE_WORKFLOW_PATH = join(PROJECT_ROOT, ".github", "workflows", "release-npm.yml");

/** Commands that would install dependencies outside the lockfile or run local gates in automation. */
const FORBIDDEN_WORKFLOW_TOKENS = [
  "run: npm install",
  "run: npm run typecheck",
  "run: npm test",
  "run: npm run verify",
  "run: npm run test:e2e",
  "run: mcp-google-api doctor",
  "scripts/build.sh",
  "scripts/pre-release-check.sh",
];

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
  // dependency installation, build, packing, and publish. No separate or
  // parallel release jobs exist. The gate fetches both branches, resolves the
  // tagged commit's reachability from origin/master and origin/develop, exports
  // both outcomes, and fails before any install, build, pack, publish, or
  // release-creation step when neither branch contains the tag.
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
  const packIdx = workflow.indexOf("run: npm pack --ignore-scripts");
  const validateIdx = workflow.indexOf("run: node tools/check-release-artifacts.mjs");
  const publishIdx = workflow.indexOf("run: npm publish --ignore-scripts --provenance --access public");
  const releaseAssetIdx = workflow.indexOf("files: mcp-google-api-*.tgz");
  for (const [name, index] of [
    ["gate", gateIdx],
    ["npm ci", installIdx],
    ["npm run build", buildIdx],
    ["npm pack", packIdx],
    ["validation", validateIdx],
    ["publish", publishIdx],
    ["release asset", releaseAssetIdx],
  ] as const) {
    assert.notEqual(index, -1, `release workflow must contain the ${name} step`);
  }
  assert.equal(gateIdx < installIdx, true);
  assert.equal(gateIdx < buildIdx, true);
  assert.equal(gateIdx < packIdx, true);
  assert.equal(gateIdx < validateIdx, true);
  assert.equal(gateIdx < publishIdx, true);
  assert.equal(gateIdx < releaseAssetIdx, true);
  assert.equal(installIdx < buildIdx, true, "dependencies must be installed before the build (PKG-110)");
  assert.equal(buildIdx < packIdx, true, "the bundle must be built before packing (PKG-110, PKG-111)");
});

test("Release workflow publishes to npm only for master-reachable tags", () => {
  // PKG-042/PKG-043: the publish step is the only step conditioned on the
  // branch-gate master output, so develop-only tags skip exactly npm
  // publication while build, packing, validation, changelog, and the
  // GitHub Release with the tarball asset still run.
  const workflow = readWorkflow(RELEASE_WORKFLOW_PATH);
  const condition = "steps.branch_gate.outputs.on_master == 'true'";
  const gateOutputIdx = workflow.indexOf("on_master=${on_master}");
  const publishIfIdx = workflow.indexOf(`if: ${condition}`);
  const publishRunIdx = workflow.indexOf("run: npm publish --ignore-scripts --provenance --access public");
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

test("Release workflow keeps local gates out of automation and builds from the locked lockfile", () => {
  // PKG-110/PKG-111: the automation installs the locked dependency tree and compiles the
  // runtime bundle, but runs no repository build script, no pre-release gate script, no
  // typecheck, and no unit-test stage, and never performs an unlocked npm install.
  const workflow = readWorkflow(RELEASE_WORKFLOW_PATH);
  const leftovers = FORBIDDEN_WORKFLOW_TOKENS.filter((token) => workflow.includes(token));
  const expected_output = { leftovers: [] as string[], present: true };
  assert.deepEqual(leftovers, expected_output.leftovers);
  assert.equal(workflow.includes("run: npm ci"), expected_output.present);
  assert.equal(workflow.includes("run: npm pack --ignore-scripts"), expected_output.present);
  assert.equal(workflow.includes("run: npm publish --ignore-scripts --provenance --access public"), expected_output.present);
});

test("Release workflow builds, packs, and validates the runtime bundle before publish and release", () => {
  // PKG-012/PKG-110/PKG-111/PKG-113: the tarball is packed from the freshly built tree with
  // `--ignore-scripts` so the `prepare` lifecycle never compiles a second time, the packed
  // payload is validated against that built tree, and publication disables lifecycle scripts so
  // `prepublishOnly` never rebuilds. Validation precedes both publication and release creation,
  // and the release asset is the packed tarball.
  const workflow = readWorkflow(RELEASE_WORKFLOW_PATH);
  const cliArtifactIdx = workflow.indexOf("dist/cli.js");
  const indexArtifactIdx = workflow.indexOf("dist/index.js");
  const packIdx = workflow.indexOf("run: npm pack --ignore-scripts");
  const validateIdx = workflow.indexOf("run: node tools/check-release-artifacts.mjs");
  const publishIdx = workflow.indexOf("run: npm publish --ignore-scripts --provenance --access public");
  const releaseAssetIdx = workflow.indexOf("files: mcp-google-api-*.tgz");
  const expected_output = {
    artifactVerificationPresent: true,
    singleBundleOnly: false,
    plainPackAbsent: false,
    validateBeforePublish: true,
    validateBeforeRelease: true,
    releaseAssetPresent: true,
  };
  assert.notEqual(cliArtifactIdx, -1);
  assert.equal(indexArtifactIdx, -1, "the workflow must not verify a dist/index.js library entry (PKG-035)");
  assert.notEqual(packIdx, -1);
  assert.notEqual(validateIdx, -1);
  assert.notEqual(publishIdx, -1);
  assert.notEqual(releaseAssetIdx, -1);
  assert.equal(workflow.includes("Verify built release artifacts in dist/"), expected_output.artifactVerificationPresent);
  assert.equal(workflow.includes("npm pack --ignore-scripts"), true);
  assert.equal(workflow.includes("run: npm pack\n"), expected_output.plainPackAbsent);
  assert.equal(packIdx < validateIdx, true);
  assert.equal(validateIdx < publishIdx, expected_output.validateBeforePublish);
  assert.equal(validateIdx < releaseAssetIdx, expected_output.validateBeforeRelease);
});

test("Release workflow publishes via npm OIDC Trusted Publishing and attaches the packed tarball", () => {
  // PKG-010/PKG-012: publish uses OIDC Trusted Publishing with provenance
  // attestation and public access; the release asset is the packed npm
  // tarball, failing on unmatched files; the tarball is packed and validated
  // before the release step attaches it.
  // PKG-030/PKG-031/PKG-032: the publish step authenticates via the GitHub
  // Actions OIDC token (`id-token: write`), references no NPM_TOKEN secret
  // and no NODE_AUTH_TOKEN variable, and runs on the pinned Node.js runtime
  // bundling npm >= 11.5.1 (OIDC Trusted Publishing floor).
  const workflow = readWorkflow(RELEASE_WORKFLOW_PATH);
  const packIdx = workflow.indexOf("run: npm pack --ignore-scripts");
  const validateIdx = workflow.indexOf("run: node tools/check-release-artifacts.mjs");
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
    tarballValidatedBeforeRelease: true,
  };
  assert.notEqual(releaseIdx, -1);
  assert.equal(workflow.includes("id-token: write"), expected_output.oidcPermissionGranted);
  assert.equal(workflow.includes("secrets.NPM_TOKEN"), expected_output.npmTokenSecretReferenced);
  assert.equal(workflow.includes("NODE_AUTH_TOKEN"), expected_output.nodeAuthTokenVariableReferenced);
  assert.equal(workflow.includes("run: npm publish --ignore-scripts --provenance --access public"), expected_output.publishCommandPresent);
  assert.equal(workflow.includes("npm >= 11.5.1"), expected_output.trustedPublishingFloorDocumented);
  assert.equal(/^  NODE_VERSION: '24\./m.test(workflow), expected_output.pinnedNodeMajor24);
  assert.equal(workflow.includes("fail_on_unmatched_files: true"), expected_output.releaseAssetPatternPresent);
  assert.equal(packIdx < releaseIdx, expected_output.tarballPackedBeforeRelease);
  assert.equal(validateIdx < releaseIdx, expected_output.tarballValidatedBeforeRelease);
});
