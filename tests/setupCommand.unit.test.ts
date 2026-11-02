import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";

// cli.ts is also the executable entrypoint and detects direct execution from
// process.argv[1]. Import it with a neutral argv value so the test process
// does not start an HTTP server as a side effect.
const originalArgv1 = process.argv[1];
process.argv[1] = "setup-command-unit-test";
const { runSetup } = await import("../src/cli.js");
process.argv[1] = originalArgv1;

const { resolveRuntimeConfig } = await import("../src/utils/configResolver.js");

interface FakeFsState {
  writes: Array<{ path: string; data: string }>;
  files: Record<string, string>;
}

function createFakeFs(files: Record<string, string>): FakeFsState {
  const state: FakeFsState = { writes: [], files: { ...files } };
  return state;
}

function fakeFsInterface(state: FakeFsState): {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: "utf-8"): string;
  writeFileSync(path: string, data: string, encoding: "utf-8"): void;
} {
  return {
    existsSync: (path) => Object.prototype.hasOwnProperty.call(state.files, path),
    readFileSync: (path) => state.files[path],
    writeFileSync: (path, data) => {
      state.writes.push({ path, data });
      state.files[path] = data;
    },
  };
}

const PACKAGE_DIR = "/fake-pkg";
const TARGET_DIR = "/fake-target";
const TEMPLATE_KEY = resolve(PACKAGE_DIR, ".env.example");
const ENV_KEY = resolve(TARGET_DIR, ".env");
const NODE_22 = "22.11.0";
const KEY_CONFIG = resolveRuntimeConfig({ GOOGLE_MAPS_API_KEY: "AIzaSyTestKey1234567890" });

test("setup without --write-env performs zero writes and skips env-file creation", async () => {
  const state = createFakeFs({ [TEMPLATE_KEY]: "GOOGLE_MAPS_API_KEY=x\n" });

  const report = await runSetup(
    { packageDir: PACKAGE_DIR, targetDir: TARGET_DIR, writeEnv: false },
    { nodeVersion: NODE_22, config: KEY_CONFIG, fs: fakeFsInterface(state) }
  );

  assert.deepEqual(state.writes, []);
  assert.equal(report.created, false);
  assert.equal(report.success, true);
  assert.equal(report.checks.find((check) => check.name === "env-file")?.status, "skip");
});

test("setup --write-env creates .env from the template only when absent", async () => {
  const state = createFakeFs({ [TEMPLATE_KEY]: "GOOGLE_MAPS_API_KEY=template\n" });

  const report = await runSetup(
    { packageDir: PACKAGE_DIR, targetDir: TARGET_DIR, writeEnv: true },
    { nodeVersion: NODE_22, config: KEY_CONFIG, fs: fakeFsInterface(state) }
  );

  assert.equal(report.created, true);
  assert.equal(report.success, true);
  assert.deepEqual(state.writes, [{ path: ENV_KEY, data: "GOOGLE_MAPS_API_KEY=template\n" }]);
  assert.equal(report.checks.find((check) => check.name === "env-file")?.status, "pass");
});

test("setup --write-env never overwrites an existing .env", async () => {
  const state = createFakeFs({
    [TEMPLATE_KEY]: "GOOGLE_MAPS_API_KEY=template\n",
    [ENV_KEY]: "GOOGLE_MAPS_API_KEY=original\n",
  });

  const report = await runSetup(
    { packageDir: PACKAGE_DIR, targetDir: TARGET_DIR, writeEnv: true },
    { nodeVersion: NODE_22, config: KEY_CONFIG, fs: fakeFsInterface(state) }
  );

  assert.equal(report.created, false);
  assert.deepEqual(state.writes, []);
  assert.equal(state.files[ENV_KEY], "GOOGLE_MAPS_API_KEY=original\n");
  assert.match(report.checks.find((check) => check.name === "env-file")?.detail ?? "", /no overwrite/);
});

test("setup fails below the Node engine floor", async () => {
  const state = createFakeFs({ [TEMPLATE_KEY]: "GOOGLE_MAPS_API_KEY=x\n" });

  const report = await runSetup(
    { packageDir: PACKAGE_DIR, targetDir: TARGET_DIR, writeEnv: false },
    { nodeVersion: "18.0.0", config: KEY_CONFIG, fs: fakeFsInterface(state) }
  );

  assert.equal(report.success, false);
  assert.equal(report.checks.find((check) => check.name === "node")?.status, "fail");
});

test("setup fails creation when the template is missing", async () => {
  const state = createFakeFs({});

  const report = await runSetup(
    { packageDir: PACKAGE_DIR, targetDir: TARGET_DIR, writeEnv: true },
    { nodeVersion: NODE_22, config: KEY_CONFIG, fs: fakeFsInterface(state) }
  );

  assert.equal(report.created, false);
  assert.deepEqual(state.writes, []);
  assert.equal(report.success, false);
  assert.equal(report.checks.find((check) => check.name === "env-file")?.status, "fail");
  assert.equal(report.checks.find((check) => check.name === "env-template")?.status, "fail");
});

test("setup reports a masked API key status without exposing the value", async () => {
  const state = createFakeFs({ [TEMPLATE_KEY]: "GOOGLE_MAPS_API_KEY=x\n" });

  const report = await runSetup(
    { packageDir: PACKAGE_DIR, targetDir: TARGET_DIR, writeEnv: false },
    { nodeVersion: NODE_22, config: KEY_CONFIG, fs: fakeFsInterface(state) }
  );

  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("AIzaSyTestKey1234567890"), false);
  assert.match(report.checks.find((check) => check.name === "api-key")?.detail ?? "", /value hidden/);
});
