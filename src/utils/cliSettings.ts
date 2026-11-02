/**
 * @file cliSettings.ts
 * @brief Persist the enabled-CLI set for the CLI configuration-management commands.
 * @details Stores `{"enabled": ["<cli>", ...]}` at
 * `<home>/.config/mcp-google-map/config.json`. Loading tolerates missing,
 * unreadable, non-object, or malformed content by returning normalized
 * defaults; saving serializes with two-space indentation plus a trailing
 * newline, writes a sibling temporary file, and replaces the target
 * atomically. Adopted from the reference `skills` settings model
 * (`$HOME/.config/skills/config.json`) so both tools share one UX.
 * @satisfies DES-018
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * @brief Ordered path segments of the settings file relative to the home root.
 * @details `.config/mcp-google-map/config.json`; first element is the dotdir.
 * @satisfies DES-018
 */
const CLI_SETTINGS_RELATIVE = [".config", "mcp-google-map", "config.json"] as const;

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
 * @param home {string | undefined} Home-directory override; defaults to `os.homedir()`.
 * @return {string} Absolute settings file path.
 * @satisfies DES-018
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
 * @satisfies DES-018
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
 * so readers never observe a partial file.
 * @param settings {CliSettings} Settings object to persist.
 * @param home {string | undefined} Home-directory override.
 * @return {string} Written settings file path.
 * @throws {Error} With descriptive message when directory creation, writing,
 * or replacement fails; the temporary file is best-effort removed.
 * @post The settings file contains the serialized `settings` object.
 * @satisfies DES-018
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
