import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CI_WORKFLOW_PATH = join(PROJECT_ROOT, ".github", "workflows", "ci.yml");

/**
 * @brief Loads the CI workflow definition as text for contract assertions.
 * @details Read once per test; the workflow file is a tracked, immutable input
 * during the test run, so caching is unnecessary. Missing file fails the test.
 * @return {string} Raw YAML text of `.github/workflows/ci.yml`.
 */
function readCiWorkflow(): string {
  return readFileSync(CI_WORKFLOW_PATH, "utf-8");
}

test("CI workflow locks the three-OS verification matrix", () => {
  const workflow = readCiWorkflow();
  assert.equal(workflow.includes("ubuntu-latest"), true);
  assert.equal(workflow.includes("macos-latest"), true);
  assert.equal(workflow.includes("windows-latest"), true);
  assert.equal(workflow.includes("fail-fast: false"), true);
});

test("CI workflow installs from the lockfile and runs the verification stages", () => {
  const workflow = readCiWorkflow();
  assert.equal(workflow.includes("npm ci"), true);
  assert.equal(workflow.includes("npm run typecheck"), true);
  assert.equal(workflow.includes("npm test"), true);
  assert.equal(workflow.includes("npm run build"), true);
  // Live e2e suite must stay excluded from CI run steps (no API key, no Google calls;
  // mentioning it in comments is allowed).
  assert.equal(workflow.includes("run: npm run test:e2e"), false);
});

test("CI workflow installs the packed tarball and runs the no-Google smoke check", () => {
  const workflow = readCiWorkflow();
  assert.equal(workflow.includes("npm pack"), true);
  assert.equal(workflow.includes("npm install -g ./mcp-google-map-*.tgz"), true);
  assert.equal(workflow.includes("mcp-google-map doctor"), true);
  assert.equal(workflow.includes("GOOGLE_MAPS_API_KEY: ci-smoke-placeholder-key"), true);
});
