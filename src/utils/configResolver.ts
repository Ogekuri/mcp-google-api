import { config as dotenvConfig } from "dotenv";
import { existsSync } from "fs";
import { isAutoUpdateDisabled } from "./autoUpdate.js";

/**
 * @brief Minimum Node.js major version required by `package.json` `engines`.
 * @details Single source of truth shared by the `doctor` local check and the
 * `setup` onboarding check so both enforce exactly the runtime floor declared
 * for the package (CTN-005). Complexity O(1); pure constant.
 * @satisfies CTN-005, REQ-070
 */
export const NODE_ENGINE_FLOOR = 22;

/**
 * @brief Default HTTP bind address (loopback) used when no host is configured.
 * @details Loopback default limits unintended network exposure; callers that
 * need all interfaces pass `--host 0.0.0.0` or set `MCP_SERVER_HOST=0.0.0.0`
 * (REQ-008, PKG-018). Complexity O(1); pure constant.
 * @satisfies REQ-008
 */
export const DEFAULT_HTTP_HOST = "127.0.0.1";

/**
 * @brief Default HTTP port used when no port is configured.
 * @details Fallback port mirroring the historical default; overridable via
 * `--port` or `MCP_SERVER_PORT` (REQ-008). Complexity O(1); pure constant.
 * @satisfies REQ-008
 */
export const DEFAULT_HTTP_PORT = 3000;

/**
 * @brief Higher-priority values that override environment-derived configuration.
 * @details Flags parsed from CLI arguments; every field optional. `flag`
 * source wins over `environment` which wins over `default`.
 */
export interface RuntimeConfigOverrides {
  apiKey?: string;
  host?: string;
  port?: number;
  envFile?: string;
}

/** @brief Origin tag attached to each resolved configuration field. */
export type RuntimeConfigSource = "flag" | "environment" | "default";

/**
 * @brief Typed snapshot of every runtime configuration field with per-field source.
 * @details Produced exclusively by `resolveRuntimeConfig`; consumed by all CLI
 * commands and `doctor` diagnostics (DES-015). `port` is undefined when the
 * configured value cannot be parsed to an integer; `portRaw` preserves the
 * original string for remediation messages.
 */
export interface ResolvedRuntimeConfig {
  apiKey: string | undefined;
  apiKeySource: "flag" | "environment" | "none";
  host: string;
  hostSource: RuntimeConfigSource;
  port: number | undefined;
  portRaw: string | undefined;
  portSource: RuntimeConfigSource;
  enabledToolsRaw: string | undefined;
  enabledToolsSource: RuntimeConfigSource;
  autoUpdateDisabled: boolean;
  envFile: string | undefined;
}

/**
 * @brief Resolves runtime configuration from an environment map plus flag overrides.
 * @details Priority per field: overrides (`flag`) > environment map
 * (`environment`) > built-in default (`default`). Port parsing: flag port used
 * as-is; environment string parsed with `Number` and left undefined when not a
 * finite integer (raw preserved in `portRaw`). `enabledToolsRaw` keeps the
 * trimmed `GOOGLE_MAPS_ENABLED_TOOLS` string; empty string normalizes to
 * undefined. `autoUpdateDisabled` delegates to `isAutoUpdateDisabled`. Pure:
 * reads inputs only, mutates nothing. Complexity O(1).
 * @param env {Record<string, string | undefined>} Environment map; defaults to `process.env`.
 * @param overrides {RuntimeConfigOverrides} Flag-derived overrides; defaults to none.
 * @return {ResolvedRuntimeConfig} Fully typed configuration with per-field sources.
 * @see isAutoUpdateDisabled
 * @see validateHttpEndpoint
 * @satisfies DES-015
 */
export function resolveRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
  overrides: RuntimeConfigOverrides = {}
): ResolvedRuntimeConfig {
  const envPort = env.MCP_SERVER_PORT?.trim() || undefined;

  let port: number | undefined;
  let portRaw: string | undefined;
  let portSource: RuntimeConfigSource;
  if (overrides.port !== undefined) {
    port = overrides.port;
    portRaw = String(overrides.port);
    portSource = "flag";
  } else if (envPort !== undefined) {
    const parsed = Number(envPort);
    port = Number.isFinite(parsed) ? parsed : undefined;
    portRaw = envPort;
    portSource = "environment";
  } else {
    port = DEFAULT_HTTP_PORT;
    portRaw = undefined;
    portSource = "default";
  }

  const apiKey = overrides.apiKey ?? env.GOOGLE_MAPS_API_KEY;
  const enabledToolsRaw = env.GOOGLE_MAPS_ENABLED_TOOLS?.trim() || undefined;

  return {
    apiKey,
    apiKeySource: overrides.apiKey !== undefined ? "flag" : apiKey ? "environment" : "none",
    host: overrides.host ?? env.MCP_SERVER_HOST ?? DEFAULT_HTTP_HOST,
    hostSource: overrides.host !== undefined ? "flag" : env.MCP_SERVER_HOST ? "environment" : "default",
    port,
    portRaw,
    portSource,
    enabledToolsRaw,
    enabledToolsSource: enabledToolsRaw ? "environment" : "default",
    autoUpdateDisabled: isAutoUpdateDisabled(env),
    envFile: overrides.envFile,
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
  apiKey: { value: string; source: "flag" | "environment" | "none" };
  httpHost: { value: string; source: RuntimeConfigSource };
  httpPort: { value: number | null; raw: string | null; source: RuntimeConfigSource };
  enabledTools: { value: string; source: RuntimeConfigSource };
  autoUpdateCheck: { enabled: boolean };
  envFile: { value: string | null };
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
    enabledTools: { value: config.enabledToolsRaw ?? "*", source: config.enabledToolsSource },
    autoUpdateCheck: { enabled: !config.autoUpdateDisabled },
    envFile: { value: config.envFile ?? null },
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
    errors.push(`invalid MCP_SERVER_PORT value "${config.portRaw ?? config.port}" (expected integer 1-65535)`);
  }
  if (!config.host || config.host.trim().length === 0) {
    errors.push("empty MCP_SERVER_HOST value (expected a non-empty bind address)");
  }
  return { valid: errors.length === 0, errors };
}

/**
 * @brief Result of loading an explicit `--env-file` file.
 * @details `ok` false carries an `error` message suitable for CLI JSON errors.
 */
export interface ExplicitEnvFileResult {
  ok: boolean;
  error?: string;
}

/**
 * @brief Loads exactly one explicit environment file via dotenv.
 * @details Checks existence first (dotenv silently ignores missing files) and
 * returns `{ ok: false, error }` when absent; otherwise loads the file without
 * overriding already-set process variables. Complexity O(file size).
 * @param path {string} Absolute or relative path to the environment file.
 * @return {ExplicitEnvFileResult} `{ ok: true }` on load; `{ ok: false, error }` when missing.
 * @satisfies CTN-009
 */
export function applyExplicitEnvFile(path: string): ExplicitEnvFileResult {
  if (!existsSync(path)) {
    return { ok: false, error: `env file not found: ${path}` };
  }
  dotenvConfig({ path });
  return { ok: true };
}

/**
 * @brief Result of resolving the `GOOGLE_MAPS_ENABLED_TOOLS` allowlist.
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
 * @param raw {string | undefined} Raw `GOOGLE_MAPS_ENABLED_TOOLS` value.
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
