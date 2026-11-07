import assert from "node:assert/strict";
import test from "node:test";

// cli.ts is also the executable entrypoint and detects direct execution from
// process.argv[1]. Import it with a neutral argv value so the test process
// does not start an HTTP server as a side effect.
const originalArgv1 = process.argv[1];
process.argv[1] = "doctor-ext-unit-test";
const { DOCTOR_PROBES, parseDoctorProbes, runDoctor } = await import("../src/cli.js");
process.argv[1] = originalArgv1;

const { resolveRuntimeConfig } = await import("../src/utils/configResolver.js");
const { loadCliSettings } = await import("../src/utils/cliSettings.js");

const NODE_24 = "24.11.0";
const CLEAN_CONFIG = resolveRuntimeConfig(
  loadCliSettings(),
  { apiKey: "AIzaSyConfigKey123456789" }
);

test("doctor enforces the Node engine floor from package.json engines", async () => {
  const oldNode = await runDoctor("1.2.3", "configured-key", false, undefined, {
    nodeVersion: "22.11.0",
    config: CLEAN_CONFIG,
  });
  assert.equal(oldNode.checks.find((check) => check.name === "node")?.status, "fail");
  assert.match(oldNode.checks.find((check) => check.name === "node")?.detail ?? "", /24 or newer/);
  assert.equal(oldNode.success, false);

  const newNode = await runDoctor("1.2.3", "configured-key", false, undefined, {
    nodeVersion: NODE_24,
    config: CLEAN_CONFIG,
  });
  assert.equal(newNode.checks.find((check) => check.name === "node")?.status, "pass");
  assert.equal(newNode.success, true);
});

test("doctor local mode reports masked configuration with per-field sources", async () => {
  const report = await runDoctor("1.2.3", "AIzaSyRequestKey12345678", false, undefined, {
    nodeVersion: NODE_24,
    config: CLEAN_CONFIG,
  });

  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("AIzaSyConfigKey123456789"), false);
  assert.equal(serialized.includes("AIzaSyRequestKey12345678"), false);
  assert.match(serialized, /AIza\*\*\*\*6789/);

  const configCheck = report.checks.find((check) => check.name === "config");
  assert.equal(configCheck?.status, "pass");
  assert.match(configCheck?.detail ?? "", /host=127\.0\.0\.1 \(settings\)/);
  assert.match(configCheck?.detail ?? "", /enabledTools=\* \(settings\)/);
});

test("doctor local mode reports per-tool Google API profiles", async () => {
  const report = await runDoctor("1.2.3", "configured-key", false, undefined, {
    nodeVersion: NODE_24,
    config: resolveRuntimeConfig(
      { ...loadCliSettings(), enabledTools: "maps_geocode,maps_directions" },
      {}
    ),
  });

  const toolsCheck = report.checks.find((check) => check.name === "tools");
  assert.equal(toolsCheck?.status, "pass");
  assert.match(toolsCheck?.detail ?? "", /2 tool\(s\) enabled/);
  assert.match(toolsCheck?.detail ?? "", /maps_geocode\[geocoding\]/);
  assert.match(toolsCheck?.detail ?? "", /maps_directions\[routes\]/);
  assert.equal(toolsCheck?.detail?.includes("network"), false);
});

test("doctor fails the config check when the allowlist matches zero tools", async () => {
  const report = await runDoctor("1.2.3", "configured-key", false, undefined, {
    nodeVersion: NODE_24,
    config: resolveRuntimeConfig(
      { ...loadCliSettings(), enabledTools: "does_not_exist" },
      {}
    ),
  });

  const configCheck = report.checks.find((check) => check.name === "config");
  assert.equal(configCheck?.status, "fail");
  assert.match(configCheck?.detail ?? "", /matched 0 tools/);
  assert.equal(report.success, false);
});

test("doctor --live probes only the selected subset with --probes", async () => {
  const calledTools: string[] = [];
  const report = await runDoctor("1.2.3", "secret-key", true, async (toolName) => {
    calledTools.push(toolName);
    return { success: true };
  }, {
    nodeVersion: NODE_24,
    config: CLEAN_CONFIG,
    probes: ["routes"],
  });

  assert.deepEqual(calledTools, ["maps_directions"]);
  assert.equal(report.checks.find((check) => check.name === "routes-api")?.status, "pass");
  assert.equal(report.checks.find((check) => check.name === "geocoding-api"), undefined);
  assert.equal(report.checks.find((check) => check.name === "places-api-new"), undefined);
  assert.equal(report.success, true);
});

test("doctor --live without --probes keeps the default three-probe invocation", async () => {
  const calledTools: string[] = [];
  const report = await runDoctor("1.2.3", "secret-key", true, async (toolName) => {
    calledTools.push(toolName);
    return { success: true };
  }, {
    nodeVersion: NODE_24,
    config: CLEAN_CONFIG,
  });

  assert.deepEqual(calledTools, ["maps_geocode", "maps_search_places", "maps_directions"]);
  assert.equal(DOCTOR_PROBES.length, 3);
  assert.equal(report.success, true);
});

test("parseDoctorProbes validates names, aliases, and rejects invalid input", () => {
  assert.deepEqual(parseDoctorProbes(undefined), { probes: undefined });

  const parsed = parseDoctorProbes("geocoding,places,routes-api");
  assert.deepEqual(parsed.probes, ["geocoding", "places-new", "routes"]);
  assert.equal(parsed.error, undefined);

  const deduped = parseDoctorProbes("geocoding,geocoding");
  assert.deepEqual(deduped.probes, ["geocoding"]);

  const unknown = parseDoctorProbes("maps");
  assert.equal(unknown.probes !== undefined && unknown.probes.length > 0, false);
  assert.match(unknown.error ?? "", /unknown probe "maps"/);

  const empty = parseDoctorProbes("  ");
  assert.match(empty.error ?? "", /--probes received no probe names/);
});
