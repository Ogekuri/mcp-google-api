/**
 * @file cliSettings.ts
 * @brief Persist the program configuration file for the CLI configuration-management commands.
 * @details Stores `{"enabled": ["<cli>", ...], "apiKey": "<key>", "autoUpdate": true}` at
 * `<home>/.config/<SETTINGS_PROGRAM_NAME>/config.json`. The settings directory
 * segment is the distribution program name `mcp-google-map` (DES-021):
 * program-owned, never a shared or generic directory such as `skills`.
 * Loading tolerates missing, unreadable, non-object, or malformed content by
 * returning normalized defaults; saving serializes with two-space
 * indentation plus a trailing newline, writes a sibling temporary file,
 * and replaces the target atomically.
 * @satisfies DES-018, DES-021, DES-023, DES-024
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * @brief Distribution program name owning the settings directory.
 * @details Single source of truth for the settings directory segment
 * (DES-021): `.config/<SETTINGS_PROGRAM_NAME>/config.json`. Program-owned
 * by `mcp-google-map`; a shared or generic name such as `skills` is
 * forbidden. Keep in sync with the `package.json` `name` field.
 * @satisfies DES-021
 */
export const SETTINGS_PROGRAM_NAME = "mcp-google-map";

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
export const MCP_SERVER_NAME = "mcp-google-map";

/**
 * @brief Legacy placeholder previously embedded as `GOOGLE_MAPS_API_KEY` in CLI MCP registrations.
 * @details Self-describing marker whose text invites running the
 * `mcp-google-map api-key <key>` command. No longer written by `install`
 * (REQ-114); retained only so `isUnsetApiKey` classifies placeholder values
 * left in existing files as unset (REQ-142).
 * @satisfies REQ-142
 */
export const INSTALL_API_KEY_PLACEHOLDER = "__RUN_mcp-google-map_api-key_TO_CONFIGURE_YOUR_API_KEY__";

/**
 * @brief Program configuration shape loaded at bootstrap and persisted by the configuration commands.
 * @details `enabled` lists canonical CLI names in persistence order; `apiKey`
 * is the Google Maps API key (DES-023) and defaults to the empty string;
 * `autoUpdate` gates the automatic update check (DES-024) and defaults to
 * true. The configuration file is the only configuration source (CTN-002,
 * REQ-083, REQ-142).
 * @satisfies DES-018, DES-023, DES-024
 */
export interface CliSettings {
  enabled: string[];
  apiKey: string;
  autoUpdate: boolean;
}

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
 * @brief Classify a candidate API key value as unset.
 * @details True for undefined/null, empty or whitespace-only strings, and the
 * literal `INSTALL_API_KEY_PLACEHOLDER` marker, so placeholder-bearing client
 * configurations never count as a configured key (REQ-142). Pure;
 * complexity O(1).
 * @param value {string | undefined | null} Candidate key from the settings file or another injection source.
 * @return {boolean} True when the value must be treated as no key.
 * @see INSTALL_API_KEY_PLACEHOLDER
 * @satisfies REQ-142
 */
export function isUnsetApiKey(value: string | undefined | null): boolean {
  return (
    value === undefined ||
    value === null ||
    value.trim().length === 0 ||
    value === INSTALL_API_KEY_PLACEHOLDER
  );
}

/**
 * @brief Load the program configuration with normalized defaults.
 * @details Reads JSON from `resolveCliSettingsPath`; missing, unreadable,
 * malformed, or non-object content yields the normalized defaults. `apiKey`
 * is accepted only as a string, defaulting to the empty string
 * (DES-023); `autoUpdate` is accepted only as a boolean, defaulting to true
 * (DES-024). Never throws.
 * @param home {string | undefined} Home-directory override.
 * @return {CliSettings} Normalized configuration object.
 * @satisfies DES-018, DES-021, DES-023, DES-024
 */
export function loadCliSettings(home?: string): CliSettings {
  try {
    const raw: unknown = JSON.parse(readFileSync(resolveCliSettingsPath(home), "utf-8"));
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return { enabled: [], apiKey: "", autoUpdate: true };
    }
    const record = raw as Record<string, unknown>;
    return {
      enabled: uniqueStrings(record.enabled),
      apiKey: typeof record.apiKey === "string" ? record.apiKey : "",
      autoUpdate: typeof record.autoUpdate === "boolean" ? record.autoUpdate : true,
    };
  } catch {
    return { enabled: [], apiKey: "", autoUpdate: true };
  }
}

/**
 * @brief Load the user-configured API key from the persisted configuration.
 * @details Reads `loadCliSettings().apiKey` and normalizes placeholder and
 * empty values to undefined so callers receive only a usable key (DES-023,
 * REQ-142). Tolerates any malformed configuration content by delegation.
 * @param home {string | undefined} Home-directory override.
 * @return {string | undefined} Configured key; undefined when unset or placeholder.
 * @see isUnsetApiKey
 * @satisfies DES-023, REQ-142
 */
export function loadConfiguredApiKey(home?: string): string | undefined {
  const apiKey = loadCliSettings(home).apiKey;
  return isUnsetApiKey(apiKey) ? undefined : apiKey;
}

/**
 * @brief Persist the program configuration to the configuration file atomically.
 * @details Creates parent directories, serializes `enabled`, `apiKey`
 * (DES-023, empty string when unset), and `autoUpdate` (DES-024) with
 * two-space indentation and a trailing newline, writes
 * `<file>.tmp`, then renames over the target so readers never observe a
 * partial file. Target path is the program-owned
 * `.config/<SETTINGS_PROGRAM_NAME>/config.json` (DES-021).
 * @param settings {CliSettings} Settings object to persist.
 * @param home {string | undefined} Home-directory override.
 * @return {string} Written settings file path.
 * @throws {Error} With descriptive message when directory creation, writing,
 * or replacement fails; the temporary file is best-effort removed.
 * @post The configuration file contains the serialized `settings` object.
 * @satisfies DES-018, DES-021, DES-023, DES-024
 */
export function saveCliSettings(settings: CliSettings, home?: string): string {
  const path = resolveCliSettingsPath(home);
  const temporary = `${path}.tmp`;
  const payload: Record<string, unknown> = {
    enabled: uniqueStrings(settings.enabled),
    apiKey: typeof settings.apiKey === "string" ? settings.apiKey : "",
    autoUpdate: settings.autoUpdate === true,
  };
  try {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(temporary, JSON.stringify(payload, null, 2) + "\n", "utf-8");
    renameSync(temporary, path);
  } catch (error: unknown) {
    throw new Error(`settings write failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return path;
}
