import assert from "node:assert/strict";
import test from "node:test";
import {
  describeRuntimeConfig,
  formatConfigDiagnostics,
  maskSecret,
  resolveEnabledToolNames,
  resolveRuntimeConfig,
  validateHttpEndpoint,
} from "../src/utils/configResolver.js";
import { loadCliSettings, type CliSettings } from "../src/utils/cliSettings.js";

const ALL_TOOLS = ["maps_geocode", "maps_search_places", "maps_place_details"];

/**
 * @brief Builds a persisted-settings object with defaults except the given overrides.
 * @param overrides {Partial<CliSettings>} Fields to override on the normalized defaults.
 * @return {CliSettings} Settings object shaped like a fresh `loadCliSettings()` result.
 */
function settings(overrides: Partial<CliSettings> = {}): CliSettings {
  return { ...loadCliSettings(), ...overrides };
}

test("resolveRuntimeConfig applies flag > settings priority with sources", () => {
  const flagConfig = resolveRuntimeConfig(
    settings({ apiKey: "settings-key", host: "settings-host", port: 4000 }),
    { apiKey: "flag-key", host: "flag-host", port: 5000 }
  );
  assert.equal(flagConfig.apiKey, "flag-key");
  assert.equal(flagConfig.apiKeySource, "flag");
  assert.equal(flagConfig.host, "flag-host");
  assert.equal(flagConfig.hostSource, "flag");
  assert.equal(flagConfig.port, 5000);
  assert.equal(flagConfig.portSource, "flag");

  const settingsConfig = resolveRuntimeConfig(
    settings({ apiKey: "settings-key", host: "settings-host", port: 4000 })
  );
  assert.equal(settingsConfig.apiKey, "settings-key");
  assert.equal(settingsConfig.apiKeySource, "settings");
  assert.equal(settingsConfig.host, "settings-host");
  assert.equal(settingsConfig.hostSource, "settings");
  assert.equal(settingsConfig.port, 4000);
  assert.equal(settingsConfig.portSource, "settings");
});

test("resolveRuntimeConfig normalizes unset keys and out-of-range settings ports", () => {
  const config = resolveRuntimeConfig(settings({ apiKey: "", port: 70000 }));
  assert.equal(config.apiKey, undefined);
  assert.equal(config.apiKeySource, "none");
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.hostSource, "settings");
  assert.equal(config.port, undefined);
  assert.equal(config.portRaw, "70000");
  assert.equal(config.portSource, "settings");

  const validation = validateHttpEndpoint(config);
  assert.equal(validation.valid, false);
  assert.equal(validation.errors.length, 1);
  assert.match(validation.errors[0], /invalid port value "70000"/);
});

test("validateHttpEndpoint accepts a well-formed endpoint", () => {
  const validation = validateHttpEndpoint(resolveRuntimeConfig(settings({ port: 3000, host: "127.0.0.1" })));
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
    resolveRuntimeConfig(settings({ apiKey: "AIzaSyVerySecretKey12345", port: 3000 }))
  );
  assert.equal(diagnostics.apiKey.value, "AIza****2345");
  assert.equal(diagnostics.apiKey.source, "settings");
  assert.equal(diagnostics.httpPort.value, 3000);
  assert.equal(diagnostics.httpPort.source, "settings");
  assert.equal(diagnostics.enabledTools.value, "*");
  assert.equal(diagnostics.autoUpdateCheck.enabled, true);

  const line = formatConfigDiagnostics(diagnostics);
  assert.match(line, /apiKey=AIza\*\*\*\*2345 \(settings\)/);
  assert.equal(line.includes("VerySecret"), false);
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
