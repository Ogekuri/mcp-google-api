/**
 * @file Static contract suite for the GitHub Actions workflow definitions.
 * @details UUT: the tracked workflow YAML contracts themselves (`.github/workflows/ci.yml`,
 * `.github/workflows/release.yml`) — the behavior contract IS the file content, so the
 * suite reads the tracked, immutable inputs directly. Level 0 (atomic static assertions;
 * no internal call-graph dependencies). External dependencies to isolate: none beyond
 * `node:fs` reads of repository-tracked files (deterministic by design; no network,
 * no clock, no environment dependence).
 *
 * Contract under test (PKG mapping):
 * - CI runs on push/PR across three OSes with lockfile install, typecheck, and unit
 *   tests only; it MUST NOT build, pack, install, or smoke-check the package (PKG-004,
 *   PKG-026).
 * - The release workflow is the only place where the package is built, verified, and
 *   published, gated on a canonical version tag whose commit is reachable from master
 *   (PKG-008, PKG-009), with the tarball install and `doctor` smoke check executed
 *   before publishing (PKG-021).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CI_WORKFLOW_PATH = join(PROJECT_ROOT, ".github", "workflows", "ci.yml");
const RELEASE_WORKFLOW_PATH = join(PROJECT_ROOT, ".github", "workflows", "release.yml");

/**
 * @brief Loads a GitHub Actions workflow definition as text for contract assertions.
 * @details Read once per test; workflow files are tracked, immutable inputs
 * during the test run, so caching is unnecessary. Missing files fail the test.
 * @param absolutePath {string} Absolute workflow file path.
 * @return {string} Raw YAML text of the workflow file.
 */
function readWorkflow(absolutePath: string): string {
  return readFileSync(absolutePath, "utf-8");
}

test("CI workflow locks the three-OS verification matrix", () => {
  const workflow = readWorkflow(CI_WORKFLOW_PATH);
  assert.equal(workflow.includes("ubuntu-latest"), true);
  assert.equal(workflow.includes("macos-latest"), true);
  assert.equal(workflow.includes("windows-latest"), true);
  assert.equal(workflow.includes("fail-fast: false"), true);
});

test("CI workflow installs from the lockfile and runs the verification stages", () => {
  const workflow = readWorkflow(CI_WORKFLOW_PATH);
  assert.equal(workflow.includes("npm ci"), true);
  assert.equal(workflow.includes("npm run typecheck"), true);
  assert.equal(workflow.includes("npm test"), true);
  // Live e2e suite must stay excluded from CI run steps (no API key, no Google calls;
  // mentioning it in comments is allowed).
  assert.equal(workflow.includes("run: npm run test:e2e"), false);
});

test("CI workflow MUST NOT build, pack, install, or smoke-check the package", () => {
  // PKG-026: the package build and tarball packing are exclusive to the
  // release workflow, so no CI step may build, pack, install the tarball,
  // or run the installed-package doctor smoke check.
  const workflow = readWorkflow(CI_WORKFLOW_PATH);
  assert.equal(workflow.includes("run: npm run build"), false);
  assert.equal(workflow.includes("run: npm pack"), false);
  assert.equal(workflow.includes("npm install -g ./mcp-google-map-*.tgz"), false);
  assert.equal(workflow.includes("run: mcp-google-map doctor"), false);
  assert.equal(workflow.includes("GOOGLE_MAPS_API_KEY: ci-smoke-placeholder-key"), false);
});

test("Release workflow is triggered only by a canonical version tag push", () => {
  // PKG-008: tag-only trigger matching v<major>.<minor>.<patch>; branch pushes
  // (including master) and pull requests never trigger the release workflow.
  const workflow = readWorkflow(RELEASE_WORKFLOW_PATH);
  assert.equal(workflow.includes("tags:"), true);
  assert.equal(workflow.includes("'v[0-9]+.[0-9]+.[0-9]+'"), true);
});

test("Release workflow gates the build job on the tagged master commit", () => {
  // PKG-009: a check-branch job resolves the tagged commit's reachability on
  // origin/master and the build-release job runs only on a positive outcome.
  const workflow = readWorkflow(RELEASE_WORKFLOW_PATH);
  assert.equal(workflow.includes("check-branch:"), true);
  assert.equal(workflow.includes("git branch -r --contains ${GITHUB_SHA} | grep -q \"origin/master\""), true);
  assert.equal(workflow.includes("needs: check-branch"), true);
  assert.equal(workflow.includes("if: needs.check-branch.outputs.is_master == 'true'"), true);
});

test("Release workflow builds, verifies, and publishes the package before release assets", () => {
  // PKG-008/PKG-021: the release job builds the package, packs the tarball,
  // installs it into a temporary environment, and runs the no-Google doctor
  // smoke check — all strictly before `npm publish` so only a verified build
  // is published; the tarball is attached to the GitHub Release.
  const workflow = readWorkflow(RELEASE_WORKFLOW_PATH);
  const buildIdx = workflow.indexOf("run: npm run build");
  const packIdx = workflow.indexOf("run: npm pack");
  const installIdx = workflow.indexOf("npm install -g ./mcp-google-map-*.tgz");
  const smokeIdx = workflow.indexOf("run: mcp-google-map doctor");
  const publishIdx = workflow.indexOf("run: npm publish --provenance --access public");
  assert.notEqual(buildIdx, -1);
  assert.notEqual(packIdx, -1);
  assert.notEqual(installIdx, -1);
  assert.notEqual(smokeIdx, -1);
  assert.notEqual(publishIdx, -1);
  assert.equal(workflow.includes("GOOGLE_MAPS_API_KEY: release-smoke-placeholder-key"), true);
  assert.equal(packIdx < publishIdx, true);
  assert.equal(installIdx < publishIdx, true);
  assert.equal(smokeIdx < publishIdx, true);
});
