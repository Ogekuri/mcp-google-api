/**
 * @fileoverview HDT unit suite for the automatic update check module.
 * @details Verifies TST-011 against REQ-082 (default-enabled), REQ-083
 * (disable flag short-circuits without network), REQ-084 (stderr upgrade
 * notice), REQ-085 (non-blocking failure tolerance). All I/O is injected:
 * `fetch`, logger, and environment are stubs, so the suite is deterministic
 * and network-free.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  checkForUpdates,
  isAutoUpdateDisabled,
  isNewerVersion,
  type AutoUpdateLogger,
} from "../src/utils/autoUpdate.js";

/**
 * @brief Records logger diagnostics without touching stderr.
 * @details Captures `log` and `error` fragments into arrays for behavioral
 * assertions; no format parsing is performed.
 * @return {{ logger: AutoUpdateLogger; logs: string[]; errors: string[] }} Logger stub plus captured output arrays.
 */
function createLoggerStub(): {
  logger: AutoUpdateLogger;
  logs: string[];
  errors: string[];
} {
  const logs: string[] = [];
  const errors: string[] = [];
  const logger: AutoUpdateLogger = {
    log: (...args: unknown[]) => {
      logs.push(args.map((item) => String(item)).join(" "));
    },
    error: (...args: unknown[]) => {
      errors.push(args.map((item) => String(item)).join(" "));
    },
  };
  return { logger, logs, errors };
}

/**
 * @brief Builds a fetch stub that answers every call with a fixed registry payload.
 * @details Records each requested URL; never inspects `init` (headers/signal
 * are irrelevant to the behavioral contract under test).
 * @param payload {unknown} JSON body returned as `{ version: ... }` registry response.
 * @param status {number} HTTP status code of the stubbed response. Defaults to 200.
 * @return {{ fetchImpl: typeof fetch; urls: string[] }} Fetch stub plus the ordered list of requested URLs.
 */
function createFetchStub(
  payload: unknown,
  status = 200
): { fetchImpl: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const fetchImpl = (async (input: unknown): Promise<Response> => {
    urls.push(String(input));
    return new Response(JSON.stringify(payload), { status });
  }) as unknown as typeof fetch;
  return { fetchImpl, urls };
}

// ---------------------------------------------------------------------------
// Level 0 — isNewerVersion (pure comparator)
// ---------------------------------------------------------------------------

test("isNewerVersion_returns_true_when_candidate_is_strictly_newer", () => {
  assert.equal(isNewerVersion("0.3.1", "0.3.0"), true);
  assert.equal(isNewerVersion("1.0.0", "0.9.9"), true);
});

test("isNewerVersion_returns_false_for_equal_or_older_versions", () => {
  assert.equal(isNewerVersion("0.3.0", "0.3.0"), false);
  assert.equal(isNewerVersion("0.2.9", "0.3.0"), false);
});

test("isNewerVersion_pads_missing_segments_with_zero", () => {
  assert.equal(isNewerVersion("1", "1.0.0"), false);
  assert.equal(isNewerVersion("2", "1.9.9"), true);
});

test("isNewerVersion_rejects_non_numeric_segments", () => {
  assert.equal(isNewerVersion("1.2.3-beta.1", "1.2.2"), false);
  assert.equal(isNewerVersion("abc", "0.0.0"), false);
  assert.equal(isNewerVersion("1.2.3", "not-a-version"), false);
});

// ---------------------------------------------------------------------------
// Level 0 — isAutoUpdateDisabled (pure env predicate)
// ---------------------------------------------------------------------------

test("isAutoUpdateDisabled_returns_false_when_variable_is_unset", () => {
  assert.equal(isAutoUpdateDisabled({}), false);
  assert.equal(isAutoUpdateDisabled({ MCP_AUTO_UPDATE_DISABLED: undefined }), false);
});

test("isAutoUpdateDisabled_returns_true_for_case_insensitive_truthy_values", () => {
  for (const value of ["1", "true", "TRUE", "Yes", " yes "]) {
    assert.equal(isAutoUpdateDisabled({ MCP_AUTO_UPDATE_DISABLED: value }), true, value);
  }
});

test("isAutoUpdateDisabled_returns_false_for_falsy_or_unknown_values", () => {
  for (const value of ["0", "false", "", "enabled", "no"]) {
    assert.equal(isAutoUpdateDisabled({ MCP_AUTO_UPDATE_DISABLED: value }), false, value);
  }
});

// ---------------------------------------------------------------------------
// Level 1 — checkForUpdates (composed; network isolated via injected fetch)
// ---------------------------------------------------------------------------

test("checkForUpdates_returns_result_and_logs_notice_when_newer_version_exists", async () => {
  const { logger, logs } = createLoggerStub();
  const { fetchImpl, urls } = createFetchStub({ version: "0.4.0" });

  const result = await checkForUpdates({
    currentVersion: "0.3.0",
    fetchImpl,
    logger,
    env: {},
  });

  assert.deepEqual(result, { currentVersion: "0.3.0", latestVersion: "0.4.0" });
  assert.equal(urls.length, 1);
  assert.equal(urls[0], "https://registry.npmjs.org/mcp-google-api/latest");
  assert.equal(logs.length, 1);
  assert.match(logs[0], /0\.3\.0/);
  assert.match(logs[0], /0\.4\.0/);
  assert.match(logs[0], /npm install -g mcp-google-api@latest/);
});

test("checkForUpdates_returns_null_without_network_when_disabled", async () => {
  const { logger, logs, errors } = createLoggerStub();
  const { fetchImpl, urls } = createFetchStub({ version: "99.0.0" });

  const result = await checkForUpdates({
    currentVersion: "0.3.0",
    fetchImpl,
    logger,
    env: { MCP_AUTO_UPDATE_DISABLED: "true" },
  });

  assert.equal(result, null);
  assert.equal(urls.length, 0);
  assert.equal(logs.length, 0);
  assert.equal(errors.length, 0);
});

test("checkForUpdates_returns_null_without_notice_when_already_latest", async () => {
  const { logger, logs } = createLoggerStub();
  const { fetchImpl } = createFetchStub({ version: "0.3.0" });

  const result = await checkForUpdates({
    currentVersion: "0.3.0",
    fetchImpl,
    logger,
    env: {},
  });

  assert.equal(result, null);
  assert.equal(logs.length, 0);
});

test("checkForUpdates_tolerates_non_ok_registry_status_with_stderr_diagnostic", async () => {
  const { logger, logs, errors } = createLoggerStub();
  const { fetchImpl } = createFetchStub({}, 503);

  const result = await checkForUpdates({
    currentVersion: "0.3.0",
    fetchImpl,
    logger,
    env: {},
  });

  assert.equal(result, null);
  assert.equal(logs.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /HTTP 503/);
});

test("checkForUpdates_tolerates_registry_payload_without_version_field", async () => {
  const { logger, errors } = createLoggerStub();
  const { fetchImpl } = createFetchStub({ "dist-tags": {} });

  const result = await checkForUpdates({
    currentVersion: "0.3.0",
    fetchImpl,
    logger,
    env: {},
  });

  assert.equal(result, null);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /no version field/);
});

test("checkForUpdates_tolerates_network_failure_without_throwing", async () => {
  const { logger, errors } = createLoggerStub();
  const fetchImpl = (async (): Promise<Response> => {
    throw new Error("ECONNREFUSED");
  }) as unknown as typeof fetch;

  const result = await checkForUpdates({
    currentVersion: "0.3.0",
    fetchImpl,
    logger,
    env: {},
  });

  assert.equal(result, null);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /ECONNREFUSED/);
});

test("checkForUpdates_skips_network_when_running_version_is_unknown", async () => {
  const { logger, errors } = createLoggerStub();
  const { fetchImpl, urls } = createFetchStub({ version: "99.0.0" });

  const result = await checkForUpdates({ fetchImpl, logger, env: {} });

  assert.equal(result, null);
  assert.equal(urls.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /version is unknown/);
});
