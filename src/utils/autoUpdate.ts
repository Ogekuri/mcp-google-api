/**
 * @fileoverview Automatic npm-registry update check executed at MCP server
 * startup (stdio and HTTP modes).
 * @details Default-enabled behavior (REQ-082); opt-out via the
 * `MCP_AUTO_UPDATE_DISABLED` environment variable (REQ-083). Fire-and-forget
 * contract: the check never throws, never blocks the caller, performs at most
 * one outbound HTTPS GET, and writes exclusively to stderr (REQ-084, REQ-085).
 */

import { Logger } from "../index.js";

/**
 * Environment variable that disables the automatic update check.
 * Inverse-polarity counterpart of an enable-style variable: unset/empty means
 * enabled (default), a truthy value means disabled.
 */
export const AUTO_UPDATE_DISABLED_ENV = "MCP_AUTO_UPDATE_DISABLED";

/** Default npm package name probed by the automatic update check. */
export const DEFAULT_PACKAGE_NAME = "mcp-google-map";

/** Default npm registry base URL (no trailing slash). */
export const DEFAULT_REGISTRY_BASE_URL = "https://registry.npmjs.org";

/** Default hard deadline for the registry GET before it is abandoned. */
export const DEFAULT_UPDATE_CHECK_TIMEOUT_MS = 2000;

/**
 * @brief Minimal logger contract consumed by the update check.
 * @details Structural subset of `Logger` (`src/index.ts`); injectable so tests
 * capture diagnostics without touching stderr.
 */
export interface AutoUpdateLogger {
  /** @param args {unknown[]} Diagnostic fragments joined for stderr output. */
  log: (...args: unknown[]) => void;
  /** @param args {unknown[]} Error diagnostic fragments for stderr output. */
  error: (...args: unknown[]) => void;
}

/**
 * @brief Dependency injection surface of `checkForUpdates`.
 * @details Every field is optional; omitted fields resolve to production
 * defaults (`process.env`, global `fetch`, `Logger`). Injection exists to keep
 * unit tests deterministic and network-free (TST-011).
 */
export interface AutoUpdateCheckerDeps {
  /** Running package version (e.g. from `package.json`); no default. */
  currentVersion?: string;
  /** Package name to resolve on the registry. Default: `DEFAULT_PACKAGE_NAME`. */
  packageName?: string;
  /** Registry origin without trailing slash. Default: `DEFAULT_REGISTRY_BASE_URL`. */
  registryBaseUrl?: string;
  /** Fetch implementation used for the registry GET. Default: global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Environment map consulted for `AUTO_UPDATE_DISABLED_ENV`. Default: `process.env`. */
  env?: Record<string, string | undefined>;
  /** Diagnostics sink. Default: `Logger` (stderr). */
  logger?: AutoUpdateLogger;
  /** Registry GET deadline in milliseconds. Default: `DEFAULT_UPDATE_CHECK_TIMEOUT_MS`. */
  timeoutMs?: number;
}

/** Successful probe outcome: versions between which an upgrade exists. */
export interface AutoUpdateResult {
  /** Running package version used for the comparison. */
  currentVersion: string;
  /** Latest version reported by the registry. */
  latestVersion: string;
}

/**
 * @brief Discriminated outcome of one registry probe without side effects.
 * @details Logging-free core result consumed by `checkForUpdates` (legacy
 * notice contract, TST-011) and by the idle-gated `checkVersionIdle` wrapper
 * (`src/utils/upgradeManager.ts`) which needs to distinguish "registry
 * reached, no newer version" from failure paths to pick its idle window.
 */
export type LatestVersionProbe =
  | { status: "disabled" }
  | { status: "unknown-version" }
  | { status: "error"; message: string }
  | { status: "current"; currentVersion: string }
  | { status: "newer"; currentVersion: string; latestVersion: string };

/**
 * @brief Probes the npm registry for the latest published package version.
 * @details Logging-free resolution order: disabled-flag short-circuit (REQ-083,
 * zero network calls) -> running-version guard (missing `currentVersion` ->
 * `unknown-version`, zero network calls) -> single
 * `GET {registry}/{package}/latest` with `timeoutMs` deadline ->
 * `response.ok` and `payload.version` validation -> `isNewerVersion` gate.
 * Every failure is returned as `{ status: "error", message }`; never throws.
 * @param deps {AutoUpdateCheckerDeps} Optional dependency overrides; production defaults when omitted.
 * @return {Promise<LatestVersionProbe>} Discriminated probe outcome; `message` carries the final diagnostic text without logging.
 * @satisfies REQ-082, REQ-083
 * @note Complexity: O(k) in version segments plus one HTTP round-trip bounded by `timeoutMs`.
 * @see isNewerVersion
 * @see checkForUpdates
 */
export async function probeLatestVersion(
  deps: AutoUpdateCheckerDeps = {}
): Promise<LatestVersionProbe> {
  const env = deps.env ?? process.env;
  if (isAutoUpdateDisabled(env)) {
    return { status: "disabled" };
  }
  const currentVersion = deps.currentVersion;
  if (!currentVersion) {
    return { status: "unknown-version" };
  }
  const packageName = deps.packageName ?? DEFAULT_PACKAGE_NAME;
  const registryBaseUrl = deps.registryBaseUrl ?? DEFAULT_REGISTRY_BASE_URL;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_UPDATE_CHECK_TIMEOUT_MS;
  const fetchImpl = deps.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(`${registryBaseUrl}/${packageName}/latest`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return {
        status: "error",
        message: `registry responded with HTTP ${response.status}.`,
      };
    }
    const payload = (await response.json()) as { version?: unknown };
    if (typeof payload?.version !== "string") {
      return {
        status: "error",
        message: "registry response has no version field.",
      };
    }
    if (!isNewerVersion(payload.version, currentVersion)) {
      return { status: "current", currentVersion };
    }
    return { status: "newer", currentVersion, latestVersion: payload.version };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "error", message };
  }
}

/**
 * @brief Evaluates the disable flag for the automatic update check.
 * @details Reads `AUTO_UPDATE_DISABLED_ENV` from the given environment map and
 * matches values `1`, `true`, `yes` case-insensitively after trimming; any
 * other value (including unset, empty, `0`, `false`) keeps the check enabled.
 * @param env {Record<string, string | undefined>} Environment map to inspect. Defaults to `process.env`.
 * @return {boolean} True when the update check is disabled; false when enabled.
 * @satisfies REQ-083
 * @note Complexity: O(1). Pure; no side effects.
 */
export function isAutoUpdateDisabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  const raw = env[AUTO_UPDATE_DISABLED_ENV];
  return typeof raw === "string" && /^(1|true|yes)$/i.test(raw.trim());
}

/**
 * @brief Compares two dotted numeric version strings.
 * @details Splits both inputs on `.` into integer segments, right-pads the
 * shorter sequence with zeroes, and returns on the first differing segment.
 * Any non-integer segment (e.g. prerelease suffix `3-beta.1`) forces False, so
 * unparseable or prerelease candidates never trigger an update notice.
 * @param candidate {string} Version reported as available (latest).
 * @param current {string} Version currently running.
 * @return {boolean} True only when `candidate` is strictly newer than `current`.
 * @satisfies REQ-084
 * @note Complexity: O(k) where k is the number of dotted segments. Pure; no side effects.
 */
export function isNewerVersion(candidate: string, current: string): boolean {
  const toSegments = (version: string): number[] =>
    version
      .trim()
      .split(".")
      .map((segment) => (/^\d+$/.test(segment) ? Number(segment) : Number.NaN));
  const candidateSegments = toSegments(candidate);
  const currentSegments = toSegments(current);
  if (
    candidateSegments.some((segment) => !Number.isInteger(segment)) ||
    currentSegments.some((segment) => !Number.isInteger(segment))
  ) {
    return false;
  }
  const length = Math.max(candidateSegments.length, currentSegments.length);
  for (let index = 0; index < length; index += 1) {
    const candidatePart = candidateSegments[index] ?? 0;
    const currentPart = currentSegments[index] ?? 0;
    if (candidatePart !== currentPart) {
      return candidatePart > currentPart;
    }
  }
  return false;
}

/**
 * @brief Runs the automatic update check against the npm registry.
 * @details Resolution order: disabled-flag short-circuit (REQ-083, zero
 * network calls) → running-version guard (missing `currentVersion` aborts with
 * an stderr diagnostic, zero network calls) → single `GET {registry}/{package}/latest`
 * with `timeoutMs` deadline → `response.ok` and `payload.version` validation →
 * `isNewerVersion` gate → stderr upgrade notice (REQ-084). Every failure path
 * (disabled, missing version, non-OK status, malformed payload, network error)
 * returns null, logs to stderr only, and never throws (REQ-085).
 * @param deps {AutoUpdateCheckerDeps} Optional dependency overrides; production defaults when omitted.
 * @return {Promise<AutoUpdateResult | null>} `{ currentVersion, latestVersion }` when a strictly newer version is published; null otherwise.
 * @satisfies REQ-082, REQ-083, REQ-084, REQ-085
 * @note Complexity: O(k) in version segments plus one HTTP round-trip bounded by `timeoutMs`.
 * @warning Must be invoked fire-and-forget (`void checkForUpdates(...)`) so server startup is never awaited on it (REQ-085).
 * @see isAutoUpdateDisabled
 * @see isNewerVersion
 */
export async function checkForUpdates(
  deps: AutoUpdateCheckerDeps = {}
): Promise<AutoUpdateResult | null> {
  const logger = deps.logger ?? Logger;
  const packageName = deps.packageName ?? DEFAULT_PACKAGE_NAME;
  const probe = await probeLatestVersion(deps);
  switch (probe.status) {
    case "disabled":
      return null;
    case "unknown-version":
      logger.error(
        `⚠️  [${DEFAULT_PACKAGE_NAME}] Automatic update check skipped: running package version is unknown.`
      );
      return null;
    case "error":
      logger.error(
        `⚠️  [${DEFAULT_PACKAGE_NAME}] Automatic update check failed: ${probe.message}`
      );
      return null;
    case "current":
      return null;
    case "newer":
      logger.log(
        `⚠️  Update available: ${packageName} ${probe.currentVersion} → ${probe.latestVersion}. ` +
          `Upgrade with: npm install -g ${packageName}@latest (or run npx -y ${packageName}@latest).`
      );
      return { currentVersion: probe.currentVersion, latestVersion: probe.latestVersion };
  }
}
