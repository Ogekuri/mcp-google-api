import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyExplicitEnvFile,
  describeRuntimeConfig,
  formatConfigDiagnostics,
  maskSecret,
  resolveEnabledToolNames,
  resolveRuntimeConfig,
  validateHttpEndpoint,
} from "../src/utils/configResolver.js";

const ALL_TOOLS = ["maps_geocode", "maps_search_places", "maps_place_details"];

test("resolveRuntimeConfig applies flag > environment > default priority with sources", () => {
  const flagConfig = resolveRuntimeConfig(
    { GOOGLE_MAPS_API_KEY: "env-key", MCP_SERVER_HOST: "env-host", MCP_SERVER_PORT: "4000" },
    { apiKey: "flag-key", host: "flag-host", port: 5000 }
  );
  assert.equal(flagConfig.apiKey, "flag-key");
  assert.equal(flagConfig.apiKeySource, "flag");
  assert.equal(flagConfig.host, "flag-host");
  assert.equal(flagConfig.hostSource, "flag");
  assert.equal(flagConfig.port, 5000);
  assert.equal(flagConfig.portSource, "flag");

  const envConfig = resolveRuntimeConfig({
    GOOGLE_MAPS_API_KEY: "env-key",
    MCP_SERVER_HOST: "env-host",
    MCP_SERVER_PORT: "4000",
  });
  assert.equal(envConfig.apiKey, "env-key");
  assert.equal(envConfig.apiKeySource, "environment");
  assert.equal(envConfig.host, "env-host");
  assert.equal(envConfig.hostSource, "environment");
  assert.equal(envConfig.port, 4000);
  assert.equal(envConfig.portSource, "environment");

  const defaultConfig = resolveRuntimeConfig({});
  assert.equal(defaultConfig.apiKey, undefined);
  assert.equal(defaultConfig.apiKeySource, "none");
  assert.equal(defaultConfig.host, "127.0.0.1");
  assert.equal(defaultConfig.hostSource, "default");
  assert.equal(defaultConfig.port, 3000);
  assert.equal(defaultConfig.portSource, "default");
});

test("resolveRuntimeConfig keeps an unparsable environment port invalid and raw", () => {
  const config = resolveRuntimeConfig({ MCP_SERVER_PORT: "not-a-number" });
  assert.equal(config.port, undefined);
  assert.equal(config.portRaw, "not-a-number");
  assert.equal(config.portSource, "environment");

  const validation = validateHttpEndpoint(config);
  assert.equal(validation.valid, false);
  assert.equal(validation.errors.length, 1);
  assert.match(validation.errors[0], /invalid MCP_SERVER_PORT value "not-a-number"/);
});

test("validateHttpEndpoint accepts a well-formed endpoint", () => {
  const validation = validateHttpEndpoint(resolveRuntimeConfig({ MCP_SERVER_PORT: "3000", MCP_SERVER_HOST: "127.0.0.1" }));
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.errors, []);
});

test("maskSecret never reveals the raw secret", () => {
  assert.equal(maskSecret(undefined), "unset");
  assert.equal(maskSecret(""), "unset");
  assert.equal(maskSecret("short"), "****");
  const masked = maskSecret("AIzaSyVerySecretKey12345");
  assert.equal(masked, "AIza****2345");
  assert.equal(masked.includes("VerySecret"), false);
});

test("describeRuntimeConfig reports masked values with per-field sources", () => {
  const diagnostics = describeRuntimeConfig(
    resolveRuntimeConfig({ GOOGLE_MAPS_API_KEY: "AIzaSyVerySecretKey12345", MCP_SERVER_PORT: "3000" })
  );
  assert.equal(diagnostics.apiKey.value, "AIza****2345");
  assert.equal(diagnostics.apiKey.source, "environment");
  assert.equal(diagnostics.httpPort.value, 3000);
  assert.equal(diagnostics.httpPort.source, "environment");
  assert.equal(diagnostics.enabledTools.value, "*");
  assert.equal(diagnostics.autoUpdateCheck.enabled, true);

  const line = formatConfigDiagnostics(diagnostics);
  assert.match(line, /apiKey=AIza\*\*\*\*2345 \(environment\)/);
  assert.equal(line.includes("VerySecret"), false);
});

test("applyExplicitEnvFile fails on missing files and loads existing ones", () => {
  const missing = applyExplicitEnvFile(join(tmpdir(), "definitely-missing-env-file-.env"));
  assert.equal(missing.ok, false);
  assert.match(missing.error ?? "", /env file not found:/);

  const dir = mkdtempSync(join(tmpdir(), "mgm-env-"));
  const envPath = join(dir, "explicit.env");
  writeFileSync(envPath, "MGM_TEST_EXPLICIT_VALUE=loaded\n", "utf-8");
  const previous = process.env.MGM_TEST_EXPLICIT_VALUE;
  try {
    const loaded = applyExplicitEnvFile(envPath);
    assert.equal(loaded.ok, true);
    assert.equal(process.env.MGM_TEST_EXPLICIT_VALUE, "loaded");
  } finally {
    if (previous === undefined) {
      delete process.env.MGM_TEST_EXPLICIT_VALUE;
    } else {
      process.env.MGM_TEST_EXPLICIT_VALUE = previous;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveEnabledToolNames implements unset, subset, and zero-match semantics", () => {
  const unset = resolveEnabledToolNames(ALL_TOOLS, undefined);
  assert.deepEqual(unset.names, ALL_TOOLS);
  assert.equal(unset.fallback, false);

  const star = resolveEnabledToolNames(ALL_TOOLS, " * ");
  assert.deepEqual(star.names, ALL_TOOLS);
  assert.equal(star.fallback, false);

  const subset = resolveEnabledToolNames(ALL_TOOLS, " maps_geocode,,maps_place_details ");
  assert.deepEqual(subset.names, ["maps_geocode", "maps_place_details"]);
  assert.equal(subset.matched, 2);
  assert.equal(subset.fallback, false);

  const zeroMatch = resolveEnabledToolNames(ALL_TOOLS, "nope");
  assert.deepEqual(zeroMatch.names, ALL_TOOLS);
  assert.equal(zeroMatch.matched, 0);
  assert.equal(zeroMatch.fallback, true);
});
