import { isUnsetApiKey, type CliSettings } from "./cliSettings.js";

/**
 * @brief Minimum Node.js major version required by `package.json` `engines`.
 * @details Single source of truth shared by the `doctor` local check so it
 * enforces exactly the runtime floor declared for the package (CTN-005).
 * Complexity O(1); pure constant.
 * @satisfies CTN-005, REQ-070
 */
export const NODE_ENGINE_FLOOR = 24;

/**
 * @brief Default HTTP bind address (loopback) used when no host is configured.
 * @details Loopback default limits unintended network exposure; callers that
 * need all interfaces pass `--host 0.0.0.0` or persist `host` in the settings
 * file (REQ-008, PKG-018). Complexity O(1); pure constant.
 * @satisfies REQ-008
 */
export const DEFAULT_HTTP_HOST = "127.0.0.1";

/**
 * @brief Default HTTP port used when no port is configured.
 * @details Fallback port mirroring the historical default; overridable via
 * `--port` or the persisted settings `port` field (REQ-008). Complexity O(1);
 * pure constant.
 * @satisfies REQ-008
 */
export const DEFAULT_HTTP_PORT = 3000;

/**
 * @brief Higher-priority values that override settings-derived configuration.
 * @details Flags parsed from CLI arguments; every field optional. `flag`
 * source wins over `settings`.
 */
export interface RuntimeConfigOverrides {
  apiKey?: string;
  host?: string;
  port?: number;
}

/** @brief Origin tag attached to each resolved configuration field. */
export type RuntimeConfigSource = "flag" | "settings";

/**
 * @brief Typed snapshot of every runtime configuration field with per-field source.
 * @details Produced exclusively by `resolveRuntimeConfig`; consumed by all CLI
 * commands and `doctor` diagnostics (DES-015). `port` is undefined when the
 * configured value cannot be used as a listen port; `portRaw` preserves the
 * original value rendering for remediation messages.
 */
export interface ResolvedRuntimeConfig {
  apiKey: string | undefined;
  apiKeySource: "flag" | "settings" | "none";
  host: string;
  hostSource: RuntimeConfigSource;
  port: number | undefined;
  portRaw: string | undefined;
  portSource: RuntimeConfigSource;
  enabledToolsRaw: string;
  enabledToolsSource: RuntimeConfigSource;
  autoUpdateDisabled: boolean;
}

/**
 * @brief Resolves runtime configuration from the persisted settings plus flag overrides.
 * @details Priority per field: overrides (`flag`) > persisted settings
 * (`settings`). The persisted settings file is the only non-flag configuration
 * source (DES-015); no environment variable is consulted. Port handling:
 * flag port used as-is; settings port kept when it is an integer in 1..65535,
 * otherwise left undefined with the raw rendering preserved in `portRaw`.
 * `apiKey` normalizes unset and placeholder settings values to undefined
 * (DES-023). `autoUpdateDisabled` is the negation of the persisted
 * `autoUpdate` field (DES-024). Pure: reads inputs only, mutates nothing.
 * Complexity O(1).
 * @param settings {CliSettings} Persisted settings loaded via `loadCliSettings`.
 * @param overrides {RuntimeConfigOverrides} Flag-derived overrides; defaults to none.
 * @return {ResolvedRuntimeConfig} Fully typed configuration with per-field sources.
 * @see validateHttpEndpoint
 * @satisfies DES-015, REQ-008
 */
export function resolveRuntimeConfig(
  settings: CliSettings,
  overrides: RuntimeConfigOverrides = {}
): ResolvedRuntimeConfig {
  const settingsPort = Number.isInteger(settings.port) && settings.port >= 1 && settings.port <= 65535
    ? settings.port
    : undefined;

  let port: number | undefined;
  let portRaw: string | undefined;
  let portSource: RuntimeConfigSource;
  if (overrides.port !== undefined) {
    port = overrides.port;
    portRaw = String(overrides.port);
    portSource = "flag";
  } else if (settingsPort !== undefined) {
    port = settingsPort;
    portRaw = String(settingsPort);
    portSource = "settings";
  } else {
    port = undefined;
    portRaw = String(settings.port);
    portSource = "settings";
  }

  const flagApiKey = overrides.apiKey !== undefined ? overrides.apiKey.trim() : undefined;
  const settingsApiKey = isUnsetApiKey(settings.apiKey) ? undefined : settings.apiKey;
  const apiKey = flagApiKey !== undefined && flagApiKey.length > 0 ? flagApiKey : settingsApiKey;
  const apiKeySource: "flag" | "settings" | "none" =
    flagApiKey !== undefined && flagApiKey.length > 0 ? "flag" : settingsApiKey !== undefined ? "settings" : "none";

  return {
    apiKey,
    apiKeySource,
    host: overrides.host ?? settings.host,
    hostSource: overrides.host !== undefined ? "flag" : "settings",
    port,
    portRaw,
    portSource,
    enabledToolsRaw: settings.enabledTools,
    enabledToolsSource: "settings",
    autoUpdateDisabled: settings.autoUpdate !== true,
  };
}

/**
 * @brief Masks a secret value for safe inclusion in reports and diagnostics.
 * @details `undefined`/empty -> `unset`; length <= 8 -> `****`; otherwise first
 * four characters + `****` + last four characters. The raw secret never
 * appears in the output. Pure; complexity O(n) in value length.
 * @param value {string | undefined} Secret to mask (e.g. Google Maps API key).
 * @return {string} Masked representation safe for stderr/stdout reports.
 * @satisfies DES-016, REQ-089
 */
export function maskSecret(value: string | undefined): string {
  if (!value) {
    return "unset";
  }
  if (value.length <= 8) {
    return "****";
  }
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

/**
 * @brief Per-field effective-value diagnostic structure with masked secrets.
 * @details Every field carries its resolved value (masked when secret) and its
 * `RuntimeConfigSource`; produced by `describeRuntimeConfig` and embedded in
 * `doctor` local reports.
 */
export interface ConfigDiagnostics {
  apiKey: { value: string; source: "flag" | "settings" | "none" };
  httpHost: { value: string; source: RuntimeConfigSource };
  httpPort: { value: number | null; raw: string | null; source: RuntimeConfigSource };
  enabledTools: { value: string; source: RuntimeConfigSource };
  autoUpdateCheck: { enabled: boolean };
}

/**
 * @brief Builds a serializable diagnostic view of a resolved configuration.
 * @details Maps `ResolvedRuntimeConfig` to `ConfigDiagnostics`, masking the API
 * key via `maskSecret` so the result is safe to print. Complexity O(1); pure.
 * @param config {ResolvedRuntimeConfig} Configuration produced by `resolveRuntimeConfig`.
 * @return {ConfigDiagnostics} Masked, source-annotated diagnostics.
 * @see maskSecret
 * @satisfies REQ-089, DES-016
 */
export function describeRuntimeConfig(config: ResolvedRuntimeConfig): ConfigDiagnostics {
  return {
    apiKey: { value: maskSecret(config.apiKey), source: config.apiKeySource },
    httpHost: { value: config.host, source: config.hostSource },
    httpPort: {
      value: config.port ?? null,
      raw: config.portRaw ?? null,
      source: config.portSource,
    },
    enabledTools: { value: config.enabledToolsRaw, source: config.enabledToolsSource },
    autoUpdateCheck: { enabled: !config.autoUpdateDisabled },
  };
}

/**
 * @brief Formats config diagnostics as one compact human-readable line.
 * @details Joins `key=value (source)` fragments; the API key is pre-masked by
 * `describeRuntimeConfig`. Used as `doctor` check detail text. Complexity O(1).
 * @param diagnostics {ConfigDiagnostics} Output of `describeRuntimeConfig`.
 * @return {string} Single-line `;`-separated diagnostic string.
 * @see describeRuntimeConfig
 * @satisfies REQ-089
 */
export function formatConfigDiagnostics(diagnostics: ConfigDiagnostics): string {
  return [
    `host=${diagnostics.httpHost.value} (${diagnostics.httpHost.source})`,
    `port=${diagnostics.httpPort.value ?? "invalid"} (raw: ${diagnostics.httpPort.raw ?? "n/a"}, ${diagnostics.httpPort.source})`,
    `apiKey=${diagnostics.apiKey.value} (${diagnostics.apiKey.source})`,
    `enabledTools=${diagnostics.enabledTools.value} (${diagnostics.enabledTools.source})`,
    `updateCheck=${diagnostics.autoUpdateCheck.enabled ? "enabled" : "disabled"}`,
  ].join("; ");
}

/**
 * @brief Outcome of HTTP endpoint validation over a resolved configuration.
 * @details `valid` is false when `errors` is non-empty; each error is a
 * remediation-oriented message.
 */
export interface HttpEndpointValidation {
  valid: boolean;
  errors: string[];
}

/**
 * @brief Validates the HTTP bind endpoint of a resolved configuration.
 * @details Rules: port must be defined, an integer in 1..65535; host must be a
 * non-empty string. Returns every violated rule as a remediation message.
 * Pure; complexity O(1).
 * @param config {ResolvedRuntimeConfig} Configuration to validate.
 * @return {HttpEndpointValidation} `valid` plus per-rule error messages.
 * @satisfies REQ-009
 */
export function validateHttpEndpoint(config: ResolvedRuntimeConfig): HttpEndpointValidation {
  const errors: string[] = [];
  if (config.port === undefined || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    errors.push(`invalid port value "${config.portRaw ?? config.port}" (expected integer 1-65535)`);
  }
  if (!config.host || config.host.trim().length === 0) {
    errors.push("empty host value (expected a non-empty bind address)");
  }
  return { valid: errors.length === 0, errors };
}

/**
 * @brief Result of resolving the persisted `enabledTools` allowlist.
 * @details `names` is the effective tool-name list; `matched` counts allowlist
 * hits; `fallback` is true when the allowlist matched zero tools and the full
 * set is returned (REQ-012); `requested` lists the parsed allowlist items.
 */
export interface EnabledToolsResolution {
  names: string[];
  matched: number;
  fallback: boolean;
  requested: string[];
}

/**
 * @brief Resolves the enabled-tool allowlist against the full tool registry.
 * @details Semantics: unset, empty, or `*` -> full set (REQ-010); at least one
 * matching name -> the named subset, items trimmed and empties ignored
 * (REQ-011); zero matches -> full set with `fallback: true` (REQ-012). Pure;
 * complexity O(n + m) with n registry names and m allowlist items.
 * @param allToolNames {readonly string[]} Full registered tool-name registry.
 * @param raw {string | undefined} Raw `enabledTools` settings value.
 * @return {EnabledToolsResolution} Effective names plus resolution metadata.
 * @satisfies REQ-010, REQ-011, REQ-012, PRJ-006
 */
export function resolveEnabledToolNames(
  allToolNames: readonly string[],
  raw: string | undefined
): EnabledToolsResolution {
  const trimmed = raw?.trim();
  if (!trimmed || trimmed === "*") {
    return { names: [...allToolNames], matched: allToolNames.length, fallback: false, requested: [] };
  }

  const requested = trimmed
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const enabled = new Set(requested);
  const names = allToolNames.filter((name) => enabled.has(name));

  if (names.length === 0) {
    return { names: [...allToolNames], matched: 0, fallback: true, requested };
  }
  return { names, matched: names.length, fallback: false, requested };
}
