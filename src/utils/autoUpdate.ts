/**
 * @fileoverview Automatic npm-registry update check executed at MCP server
 * startup (stdio and HTTP modes).
 * @details Default-enabled behavior (REQ-082); opt-out via the persisted
 * settings `autoUpdate` field (DES-024, REQ-083), evaluated by the startup
 * call site before invoking the check. Fire-and-forget contract: the check
 * never throws, never blocks the caller, performs at most one outbound HTTPS
 * GET, and writes exclusively to stderr (REQ-084, REQ-085).
 */

import { Logger } from "../index.js";

/**
 * @brief Legacy environment variable recognized only on explicitly injected disable maps.
 * @details No production call site passes an environment to the checker, so
 * this variable has no effect on the running server (REQ-083: the disable
 * decision comes from the persisted settings `autoUpdate` field, DES-024).
 * The constant survives solely for the injected `deps.env` test seam.
 */
export const AUTO_UPDATE_DISABLED_ENV = "MCP_AUTO_UPDATE_DISABLED";

/** Default npm package name probed by the automatic update check. */
export const DEFAULT_PACKAGE_NAME = "mcp-google-api";

/** Default npm registry base URL (no trailing slash). */
export const DEFAULT_REGISTRY_BASE_URL = "https://registry.npmjs.org";

/** Default hard deadline for the registry GET before it is abandoned. */
export const DEFAULT_UPDATE_CHECK_TIMEOUT_MS = 2000;

/**
 * @brief Accept header selecting the abbreviated npm packument manifest.
 * @details Best-practice registry content negotiation (REQ-179): the
 * abbreviated packument (`application/vnd.npm.install-v1+json`) carries the
 * `dist-tags` document listing every published version at a fraction of the
 * full packument payload size.
 */
export const DEFAULT_PACKUMENT_ACCEPT_HEADER = "application/vnd.npm.install-v1+json";

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
 * defaults (global `fetch`, `Logger`; no environment input is consulted by
 * default, REQ-083). Injection exists to keep unit tests deterministic and
 * network-free (TST-011).
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
  /** Explicitly injected disable map consumed by tests only; production call sites MUST leave it undefined (REQ-083). */
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
 * @details Logging-free resolution order: disable-injection short-circuit
 * (only when an explicit `deps.env` disable map is supplied; production
 * supplies none, so the effective gate is the persisted settings field,
 * REQ-083, DES-024; zero network calls) -> running-version guard (missing
 * `currentVersion` ->
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
  const env = deps.env;
  if (env !== undefined && isAutoUpdateDisabled(env)) {
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
 * @brief Probes the npm registry packument manifest for the latest published package version.
 * @details Logging-free resolution order mirroring `probeLatestVersion`:
 * disable-injection short-circuit (only when an explicit `deps.env` disable
 * map is supplied; production call sites pass none, REQ-083) ->
 * running-version guard (missing `currentVersion` -> `unknown-version`, zero
 * network calls) -> single `GET {registry}/{package}` fetching the packument
 * manifest listing every published version, negotiated with the
 * abbreviated-manifest Accept header (`DEFAULT_PACKUMENT_ACCEPT_HEADER`) and
 * bounded by `timeoutMs` -> `response.ok` and `payload["dist-tags"].latest`
 * validation -> `isNewerVersion` gate. The npmjs latest version is resolved
 * exclusively from the manifest `dist-tags.latest` field (REQ-179, REQ-180).
 * Every failure is returned as `{ status: "error", message }`; never throws.
 * @param deps {AutoUpdateCheckerDeps} Optional dependency overrides; production defaults when omitted.
 * @return {Promise<LatestVersionProbe>} Discriminated probe outcome; `message` carries the final diagnostic text without logging.
 * @satisfies REQ-179, REQ-180, REQ-161
 * @note Complexity: O(k) in version segments plus one HTTP round-trip bounded by `timeoutMs`.
 * @see probeLatestVersion
 * @see isNewerVersion
 */
export async function probeLatestManifestVersion(
  deps: AutoUpdateCheckerDeps = {}
): Promise<LatestVersionProbe> {
  const env = deps.env;
  if (env !== undefined && isAutoUpdateDisabled(env)) {
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
    const response = await fetchImpl(`${registryBaseUrl}/${packageName}`, {
      headers: { accept: DEFAULT_PACKUMENT_ACCEPT_HEADER },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return {
        status: "error",
        message: `registry manifest responded with HTTP ${response.status}.`,
      };
    }
    const payload = (await response.json()) as { "dist-tags"?: unknown };
    const distTags = payload?.["dist-tags"];
    const latest =
      distTags !== null && typeof distTags === "object"
        ? (distTags as Record<string, unknown>).latest
        : undefined;
    if (typeof latest !== "string" || latest.trim() === "") {
      return {
        status: "error",
        message: "registry manifest has no dist-tags.latest field.",
      };
    }
    if (!isNewerVersion(latest, currentVersion)) {
      return { status: "current", currentVersion };
    }
    return { status: "newer", currentVersion, latestVersion: latest };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "error", message };
  }
}

/**
 * @brief Evaluates an explicitly injected disable map for the automatic update check.
 * @details Reads `AUTO_UPDATE_DISABLED_ENV` from the given map and matches
 * values `1`, `true`, `yes` case-insensitively after trimming; any other
 * value (including unset, empty, `0`, `false`) keeps the check enabled.
 * Injection seam only: production call sites never pass a map, so the
 * effective disable decision is the persisted settings `autoUpdate` field
 * (REQ-083, DES-024).
 * @param env {Record<string, string | undefined>} Explicitly injected map; tests supply it, production MUST NOT.
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

/** Default GitHub releases API URL resolving the latest published release of the distribution repository. */
export const DEFAULT_GITHUB_RELEASES_API_URL =
  "https://api.github.com/repos/Ogekuri/mcp-google-api/releases/latest";

/**
 * @brief Dependency injection surface of `probeLatestGitHubVersion`.
 * @details Every field is optional; omitted fields resolve to production
 * defaults (global `fetch`, `DEFAULT_GITHUB_RELEASES_API_URL`,
 * `DEFAULT_UPDATE_CHECK_TIMEOUT_MS`). Injection keeps unit tests
 * deterministic and network-free.
 */
export interface GitHubProbeDeps {
  /** GitHub releases API URL returning the latest-release JSON document. Default: `DEFAULT_GITHUB_RELEASES_API_URL`. */
  releasesUrl?: string;
  /** Fetch implementation used for the releases GET. Default: global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Releases GET deadline in milliseconds. Default: `DEFAULT_UPDATE_CHECK_TIMEOUT_MS`. */
  timeoutMs?: number;
}

/**
 * @brief Discriminated outcome of one GitHub latest-release probe without side effects.
 * @details Logging-free core result consumed by the `--ver`/`--version`
 * command (`runVersionCommand`, `src/utils/upgradeManager.ts`), which renders
 * `error` as `unknown (<message>)` on the `GitHub latest:` stdout line
 * (REQ-164, REQ-181), and by the develop-channel `--upgrade` flow, which
 * installs the raw `tag` ref (REQ-171, REQ-177).
 */
export type GitHubLatestVersionProbe =
  | { status: "ok"; version: string; tag: string }
  | { status: "error"; message: string };

/**
 * @brief Strips the release-tag prefix from a GitHub release tag.
 * @details Trims surrounding whitespace, removes one leading `v`/`V`, and
 * returns the remaining text.
 * @param tag {string} Raw `tag_name` value from the GitHub releases API.
 * @return {string} Version text without the leading `v`; possibly empty.
 * @note Complexity: O(n) in tag length. Pure; no side effects.
 */
function stripReleaseTagPrefix(tag: string): string {
  return tag.trim().replace(/^v/i, "");
}

/**
 * @brief Extracts the human-readable failure cause from a failed GitHub API response body.
 * @details Reads the unconsumed response body as JSON and returns its
 * `message` field when it is a non-empty string (GitHub error payloads carry
 * the actual failure cause, e.g. HTTP 404 rate-limit exhaustion, in
 * `message`). Returns undefined for any non-JSON body, malformed payload,
 * missing or empty `message`, or body-read failure; never throws.
 * @param response {Response} Failed HTTP response whose body has not been consumed.
 * @return {Promise<string | undefined>} Trimmed `message` text, or undefined when unavailable.
 * @note Complexity: O(n) in body size. Tolerates partial `Response` injection
 * stubs lacking a `json` method (the failed-body read is caught).
 * @see probeLatestGitHubVersion
 * @satisfies REQ-181
 */
async function readGitHubErrorDetail(response: Response): Promise<string | undefined> {
  try {
    const payload = (await response.json()) as { message?: unknown } | null;
    const detail = typeof payload?.message === "string" ? payload.message.trim() : "";
    return detail.length > 0 ? detail : undefined;
  } catch {
    return undefined;
  }
}

/**
 * @brief Probes the GitHub releases API for the latest published release version.
 * @details Logging-free resolution order: single `GET {releasesUrl}` with the
 * `timeoutMs` deadline and the GitHub-mandatory `user-agent` header ->
 * `response.ok` validation -> `payload.tag_name` validation -> leading `v`
 * prefix strip. Never consults the idle cache and never gates on the
 * persisted settings `autoUpdate` field: callers own the manual-command
 * context (REQ-161, REQ-177). Every failure (non-OK status, malformed payload,
 * network error) is returned as `{ status: "error", message }`; the non-OK
 * status message embeds the API error `message` body field when parseable so
 * the rendered `unknown (<reason>)` reflects the actual failure (REQ-181);
 * never throws.
 * @param deps {GitHubProbeDeps} Optional dependency overrides; production defaults when omitted.
 * @return {Promise<GitHubLatestVersionProbe>} `ok` with the stripped version text plus the raw `tag_name`, or `error` with the diagnostic message.
 * @satisfies REQ-161, REQ-163, REQ-171, REQ-177, REQ-181
 * @note Complexity: O(n) in tag length plus one HTTP round-trip bounded by `timeoutMs`.
 * @see probeLatestVersion
 */
export async function probeLatestGitHubVersion(
  deps: GitHubProbeDeps = {}
): Promise<GitHubLatestVersionProbe> {
  const releasesUrl = deps.releasesUrl ?? DEFAULT_GITHUB_RELEASES_API_URL;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_UPDATE_CHECK_TIMEOUT_MS;
  const fetchImpl = deps.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(releasesUrl, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": DEFAULT_PACKAGE_NAME,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      const detail = await readGitHubErrorDetail(response);
      const cause = detail ? `: ${detail.replace(/\.+$/, "")}` : "";
      return {
        status: "error",
        message: `GitHub releases API responded with HTTP ${response.status}${cause}.`,
      };
    }
    const payload = (await response.json()) as { tag_name?: unknown };
    if (typeof payload?.tag_name !== "string") {
      return {
        status: "error",
        message: "GitHub releases response has no tag_name field.",
      };
    }
    const version = stripReleaseTagPrefix(payload.tag_name);
    if (!version) {
      return { status: "error", message: "GitHub release tag carries no version." };
    }
    return { status: "ok", version, tag: payload.tag_name };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "error", message };
  }
}
