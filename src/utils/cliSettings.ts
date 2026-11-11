/**
 * @file cliSettings.ts
 * @brief Persist the program configuration file for the CLI configuration-management commands.
 * @details Stores `{"enabled": ["<cli>", ...], "apiKey": "<key>", "autoUpdate": true, "enabledTools": "*", "host": "127.0.0.1", "port": 3000}` at
 * `<home>/.config/<SETTINGS_PROGRAM_NAME>/config.json`. The settings directory
 * segment is the distribution program name `mcp-google-api` (DES-021):
 * program-owned, never a shared or generic directory such as `skills`.
 * Loading tolerates missing, unreadable, non-object, or malformed content by
 * returning normalized defaults; saving serializes with two-space
 * indentation plus a trailing newline, writes a sibling temporary file,
 * and replaces the target atomically.
 * @satisfies DES-018, DES-021, DES-023, DES-024, DES-026, REQ-167, REQ-168, REQ-169
 */

import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CONFIG_DEFAULTS, CONFIG_SECTION, type ConfigDocument } from "./configSchema.js";

/**
 * @brief Distribution program name owning the settings directory.
 * @details Single source of truth for the settings directory segment
 * (DES-021): `.config/<SETTINGS_PROGRAM_NAME>/config.json`. Program-owned
 * by `mcp-google-api`; a shared or generic name such as `skills` is
 * forbidden. Keep in sync with the `package.json` `name` field.
 * @satisfies DES-021
 */
export const SETTINGS_PROGRAM_NAME = "mcp-google-api";

/**
 * @brief Ordered path segments of the settings file relative to the home root.
 * @details `.config/<SETTINGS_PROGRAM_NAME>/config.json`; first element is
 * the XDG-style dotdir, second the program-owned directory name (DES-021).
 * @satisfies DES-018, DES-021
 */
const CLI_SETTINGS_RELATIVE = [".config", SETTINGS_PROGRAM_NAME, "config.json"] as const;

/**
 * @brief Canonical server key used in every CLI MCP configuration.
 * @details Registered and removed under this exact name in JSON `mcpServers`
 * maps and TOML `mcp_servers` tables.
 */
export const MCP_SERVER_NAME = "mcp-google-api";

/**
 * @brief Program configuration shape loaded at bootstrap and persisted by the configuration commands.
 * @details `enabled` lists canonical CLI names in persistence order; `apiKey`
 * is the Google Maps API key (DES-023) and defaults to the empty string;
 * `autoUpdate` gates the automatic update check (DES-024) and defaults to
 * true; `enabledTools` is the tool allowlist (`*` = full set, REQ-167);
 * `host` is the HTTP bind address (REQ-168); `port` is the HTTP port
 * (REQ-169). The configuration file is the only configuration source
 * (CTN-002, DES-015, REQ-083, REQ-142).
 * @satisfies DES-018, DES-023, DES-024, DES-025, REQ-167, REQ-168, REQ-169, REQ-193
 */
export interface CliSettings extends ConfigDocument {}

/**
 * @brief Resolve the user settings file path for a home root.
 * @details Joins the effective home directory with
 * `.config/<SETTINGS_PROGRAM_NAME>/config.json` — the program-owned path
 * derived from the distribution name, never a shared directory (DES-021).
 * @param home {string | undefined} Home-directory override; defaults to `os.homedir()`.
 * @return {string} Absolute settings file path.
 * @satisfies DES-018, DES-021
 */
export function resolveCliSettingsPath(home?: string): string {
  const root = home ?? (process.env.HOME ?? process.cwd());
  return resolve(root, ...CLI_SETTINGS_RELATIVE);
}

/**
 * @brief Normalize an arbitrary parsed `enabledTools` value.
 * @details Accepts only strings; trims surrounding whitespace; collapses an
 * empty result to the `"*"` full-set default so hand-edited files never
 * disable every tool by omission (DES-018, REQ-167). Pure; complexity O(n).
 * @param value {unknown} Candidate JSON value.
 * @return {string} Normalized allowlist string.
 */
function normalizeEnabledTools(value: unknown): string {
  if (typeof value !== "string") {
    return CONFIG_DEFAULTS.enabledTools;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : CONFIG_DEFAULTS.enabledTools;
}

/**
 * @brief Normalize an arbitrary parsed `host` value.
 * @details Accepts only non-empty strings after trimming; any other value
 * (missing, empty, non-string) yields the loopback default (DES-018,
 * REQ-168). Pure; complexity O(n).
 * @param value {unknown} Candidate JSON value.
 * @return {string} Normalized bind hostname.
 */
function normalizeHost(value: unknown): string {
  if (typeof value !== "string") {
    return CONFIG_DEFAULTS.host;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : CONFIG_DEFAULTS.host;
}

/**
 * @brief Normalize an arbitrary parsed `port` value.
 * @details Accepts finite integers in 1..65535; any other value (missing,
 * fractional, out-of-range, non-number) yields the default port 3000
 * (DES-018, REQ-169). Pure; complexity O(1).
 * @param value {unknown} Candidate JSON value.
 * @return {number} Normalized HTTP port.
 */
function normalizePort(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65535) {
    return CONFIG_DEFAULTS.port;
  }
  return value;
}

/**
 * @brief Build the normalized default configuration.
 * @details Single source of the load-time defaults shared by every error and
 * miss path of `loadCliSettings` (DES-018). Complexity O(1); pure.
 * @return {CliSettings} Default settings object.
 */
function defaultSettings(): CliSettings {
  return {
    enabled: [...CONFIG_DEFAULTS.enabled],
    apiKey: CONFIG_DEFAULTS.apiKey,
    autoUpdate: CONFIG_DEFAULTS.autoUpdate,
    enabledTools: CONFIG_DEFAULTS.enabledTools,
    host: CONFIG_DEFAULTS.host,
    port: CONFIG_DEFAULTS.port,
  };
}

/**
 * @brief Read the persisted settings document without normalizing it.
 * @details Returns the parsed JSON object so configuration mutations can
 * validate the whole document strictly before writing (REQ-204, REQ-206). A
 * missing file yields an empty object with `exists: false`; unreadable or
 * malformed content yields a diagnostic instead of silent defaults, so a
 * `--set`/`--unset` never rewrites a file it could not parse.
 * @param home {string | undefined} Home-directory override.
 * @return {{ ok: true; document: Record<string, unknown>; exists: boolean } | { ok: false; error: string }} Parsed document or diagnostic.
 * @note Complexity O(file size).
 * @see validateConfigDocument
 * @satisfies DES-018, DES-025, REQ-206
 */
export function readCliSettingsDocument(
  home?: string
): { readonly ok: true; readonly document: Record<string, unknown>; readonly exists: boolean } | { readonly ok: false; readonly error: string } {
  const path = resolveCliSettingsPath(home);
  if (!existsSync(path)) {
    return { ok: true, document: {}, exists: false };
  }
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `settings file ${path} cannot be read: ${message}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `settings file ${path} is not valid JSON: ${message}` };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: `settings file ${path} must contain a JSON object` };
  }
  return { ok: true, document: parsed as Record<string, unknown>, exists: true };
}

/**
 * @brief Initialize the settings file from schema defaults when it is missing.
 * @details Creates the program-owned directory and writes the canonical
 * default document only when the file does not exist, so an existing user file
 * is never rewritten (REQ-199). Every configuration display and mutation
 * command calls this first.
 * @param home {string | undefined} Home-directory override.
 * @return {string} Absolute settings file path.
 * @throws {Error} When the default document cannot be persisted.
 * @satisfies DES-018, REQ-199
 */
export function bootstrapCliSettings(home?: string): string {
  const path = resolveCliSettingsPath(home);
  if (existsSync(path)) {
    return path;
  }
  return saveCliSettings(defaultSettings(), home);
}

/**
 * @brief Classify a candidate API key value as unset.
 * @details True for undefined/null and empty or whitespace-only strings
 * (REQ-142). Pure; complexity O(1).
 * @param value {string | undefined | null} Candidate key from the settings file or another injection source.
 * @return {boolean} True when the value must be treated as no key.
 * @satisfies REQ-142
 */
export function isUnsetApiKey(value: string | undefined | null): boolean {
  return value === undefined || value === null || value.trim().length === 0;
}

/**
 * @brief Normalize an arbitrary parsed value into unique non-empty strings.
 * @param value {unknown} Candidate JSON value.
 * @return {string[]} Unique strings in first-seen order; empty for non-lists.
 */
function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.length > 0 && !result.includes(item)) {
      result.push(item);
    }
  }
  return result;
}

/**
 * @brief Load the program configuration with normalized defaults.
 * @details Reads JSON from `resolveCliSettingsPath`; missing, unreadable,
 * malformed, or non-object content yields the normalized defaults. `apiKey`
 * is accepted only as a string, defaulting to the empty string
 * (DES-023); `autoUpdate` is accepted only as a boolean, defaulting to true
 * (DES-024); `enabledTools`, `host`, and `port` are normalized per their
 * dedicated helpers (REQ-167, REQ-168, REQ-169). Never throws.
 * @param home {string | undefined} Home-directory override.
 * @return {CliSettings} Normalized configuration object.
 * @satisfies DES-018, DES-021, DES-023, DES-024, REQ-167, REQ-168, REQ-169
 */
export function loadCliSettings(home?: string): CliSettings {
  try {
    const raw: unknown = JSON.parse(readFileSync(resolveCliSettingsPath(home), "utf-8"));
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return defaultSettings();
    }
    const record = raw as Record<string, unknown>;
    return {
      enabled: uniqueStrings(record.enabled),
      apiKey: typeof record.apiKey === "string" ? record.apiKey : "",
      autoUpdate: typeof record.autoUpdate === "boolean" ? record.autoUpdate : true,
      enabledTools: normalizeEnabledTools(record.enabledTools),
      host: normalizeHost(record.host),
      port: normalizePort(record.port),
    };
  } catch {
    return defaultSettings();
  }
}

/**
 * @brief Load the user-configured API key from the persisted configuration.
 * @details Reads `loadCliSettings().apiKey` and normalizes empty values to
 * undefined so callers receive only a usable key (DES-023, REQ-142).
 * Tolerates any malformed configuration content by delegation.
 * @param home {string | undefined} Home-directory override.
 * @return {string | undefined} Configured key; undefined when unset.
 * @see isUnsetApiKey
 * @satisfies DES-023, REQ-142
 */
export function loadConfiguredApiKey(home?: string): string | undefined {
  const apiKey = loadCliSettings(home).apiKey;
  return isUnsetApiKey(apiKey) ? undefined : apiKey;
}

/**
 * @brief Persist the program configuration to the configuration file atomically.
 * @details Creates parent directories, serializes the schema fields in
 * declaration order with two-space indentation plus a trailing newline, writes a
 * sibling temporary file, flushes and fsyncs it, renames it over the target, and
 * fsyncs the containing directory so the replacement is durable (DES-026). The
 * mode of an existing target is preserved; a new file is created with `0600`
 * because it may hold the plaintext API key. A failed write leaves the previous
 * valid file untouched and removes the temporary file (REQ-206).
 * @param settings {CliSettings} Settings object to persist.
 * @param home {string | undefined} Home-directory override.
 * @return {string} Written settings file path.
 * @throws {Error} With descriptive message when directory creation, writing,
 * flushing, or replacement fails; the temporary file is best-effort removed.
 * @post The configuration file contains the serialized `settings` object.
 * @satisfies DES-018, DES-021, DES-023, DES-024, DES-026, REQ-167, REQ-168, REQ-169, REQ-206
 */
export function saveCliSettings(settings: CliSettings, home?: string): string {
  const path = resolveCliSettingsPath(home);
  const temporary = `${path}.tmp`;
  const normalized: CliSettings = {
    enabled: uniqueStrings(settings.enabled),
    apiKey: typeof settings.apiKey === "string" ? settings.apiKey : "",
    autoUpdate: settings.autoUpdate === true,
    enabledTools: normalizeEnabledTools(settings.enabledTools),
    host: normalizeHost(settings.host),
    port: normalizePort(settings.port),
  };
  const payload: Record<string, unknown> = {};
  for (const parameter of CONFIG_SECTION.parameters) {
    payload[parameter.token] = normalized[parameter.token];
  }
  const serialized = JSON.stringify(payload, null, 2) + "\n";
  let mode = 0o600;
  try {
    mode = statSync(path).mode & 0o777;
  } catch {
    mode = 0o600;
  }
  try {
    mkdirSync(join(path, ".."), { recursive: true });
    const handle = openSync(temporary, "w", mode);
    try {
      writeFileSync(handle, serialized, "utf-8");
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
    renameSync(temporary, path);
    const directory = join(path, "..");
    let directoryHandle: number | undefined;
    try {
      directoryHandle = openSync(directory, "r");
      fsyncSync(directoryHandle);
    } catch {
      // Directory fsync is unavailable on some platforms; the file fsync plus
      // the atomic rename already guarantee the previous file survives failure.
    } finally {
      if (directoryHandle !== undefined) {
        closeSync(directoryHandle);
      }
    }
  } catch (error: unknown) {
    try {
      unlinkSync(temporary);
    } catch {
      // Best-effort cleanup; the original file stays untouched.
    }
    throw new Error(`settings write failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return path;
}
