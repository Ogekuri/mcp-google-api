/**
 * @file cliSettings.ts
 * @brief Persist the enabled-CLI set for the CLI configuration-management commands.
 * @details Stores `{"enabled": ["<cli>", ...]}` at
 * `<home>/.config/<SETTINGS_PROGRAM_NAME>/config.json`. The settings directory
 * segment is the distribution program name `mcp-google-map` (DES-021):
 * program-owned, never a shared or generic directory such as `skills`.
 * Loading tolerates missing, unreadable, non-object, or malformed content by
 * returning normalized defaults; saving serializes with two-space
 * indentation plus a trailing newline, writes a sibling temporary file,
 * and replaces the target atomically.
 * @satisfies DES-018, DES-021
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
 * @brief User settings shape consumed by enable/disable/install/uninstall/show.
 * @details `enabled` lists canonical CLI names in persistence order.
 */
export interface CliSettings {
  enabled: string[];
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
 * @brief Load the user settings with normalized defaults.
 * @details Reads JSON from `resolveCliSettingsPath`; missing, unreadable,
 * malformed, or non-object content yields `{ enabled: [] }`. Never throws.
 * @param home {string | undefined} Home-directory override.
 * @return {CliSettings} Normalized settings object.
 * @satisfies DES-018, DES-021
 */
export function loadCliSettings(home?: string): CliSettings {
  try {
    const raw: unknown = JSON.parse(readFileSync(resolveCliSettingsPath(home), "utf-8"));
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return { enabled: [] };
    }
    return { enabled: uniqueStrings((raw as Record<string, unknown>).enabled) };
  } catch {
    return { enabled: [] };
  }
}

/**
 * @brief Persist settings to the user settings file atomically.
 * @details Creates parent directories, serializes with two-space indentation
 * and a trailing newline, writes `<file>.tmp`, then renames over the target
 * so readers never observe a partial file. Target path is the program-owned
 * `.config/<SETTINGS_PROGRAM_NAME>/config.json` (DES-021).
 * @param settings {CliSettings} Settings object to persist.
 * @param home {string | undefined} Home-directory override.
 * @return {string} Written settings file path.
 * @throws {Error} With descriptive message when directory creation, writing,
 * or replacement fails; the temporary file is best-effort removed.
 * @post The settings file contains the serialized `settings` object.
 * @satisfies DES-018, DES-021
 */
export function saveCliSettings(settings: CliSettings, home?: string): string {
  const path = resolveCliSettingsPath(home);
  const temporary = `${path}.tmp`;
  try {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(temporary, JSON.stringify({ enabled: uniqueStrings(settings.enabled) }, null, 2) + "\n", "utf-8");
    renameSync(temporary, path);
  } catch (error: unknown) {
    throw new Error(`settings write failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return path;
}
