/**
 * @file cliTargets.ts
 * @brief Provide per-CLI MCP-configuration and skills-destination adapters.
 * @details Defines one adapter for each supported CLI agent (`pi`,
 * `openclaw`, `codex`, `antigravity`, `claude`, `copilot`) resolving the MCP
 * configuration file and the skills destination directory from an injectable
 * home root. MCP registration applies read-modify-write: JSON targets merge
 * the `mcpServers["mcp-google-api"]` entry preserving every unrelated key;
 * the TOML target (codex) appends or removes the `[mcp_servers.<name>]`
 * table without touching other tables. Skill synchronization copies packaged
 * skill content with overwrite and prunes stale files inside managed
 * skill directories only, preserving unmanaged destination entries; a skill's
 * declared debug overlay is excluded as a standalone file and is appended to
 * the installed `SKILL.md` only when debug skills are requested. Paths
 * adopted from the reference `skills` installer targets.
 * @satisfies DES-017, DES-019, DES-020, REQ-110, REQ-112, REQ-113, REQ-155, REQ-156, REQ-157, REQ-158
 */

import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * @brief Canonical identifiers of the supported CLI agents.
 * @details Registry order: pi, openclaw, codex, antigravity, claude, copilot.
 */
export type CliTargetId = "pi" | "openclaw" | "codex" | "antigravity" | "claude" | "copilot";

/**
 * @brief MCP-server registration entry written into CLI configurations.
 * @details stdio launcher shape consumed by every supported CLI agent.
 */
export interface McpServerRegistration {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * @brief Configuration format of one CLI's MCP configuration file.
 * @details `json` targets expose a `mcpServers` object map; `toml` targets
 * expose `mcp_servers` tables (codex `config.toml`).
 */
export type CliConfigFormat = "json" | "toml";

/**
 * @brief Adapter describing one supported CLI installation target.
 * @details Pure path/format descriptor; all operations are module functions
 * parameterized by the adapter so each CLI stays data-driven.
 */
export interface CliTarget {
  id: CliTargetId;
  configFormat: CliConfigFormat;
  mcpConfigPath(home?: string): string;
  skillsDir(home?: string): string;
}

/** @brief Resolve the effective home root. */
function homeRoot(home?: string): string {
  return home ?? (process.env.HOME ?? process.cwd());
}

/** @brief pi adapter: `~/.pi/agent/mcp.json` + `~/.pi/agent/skills`. */
const PI_TARGET: CliTarget = {
  id: "pi",
  configFormat: "json",
  mcpConfigPath: (home) => join(homeRoot(home), ".pi", "agent", "mcp.json"),
  skillsDir: (home) => join(homeRoot(home), ".pi", "agent", "skills"),
};

/** @brief openclaw adapter: `~/.openclaw/openclaw.json` + workspace skills. */
const OPENCLAW_TARGET: CliTarget = {
  id: "openclaw",
  configFormat: "json",
  mcpConfigPath: (home) => join(homeRoot(home), ".openclaw", "openclaw.json"),
  skillsDir: (home) => join(homeRoot(home), ".openclaw", "workspace", "skills"),
};

/** @brief codex adapter: `~/.codex/config.toml` + `~/.codex/skills`. */
const CODEX_TARGET: CliTarget = {
  id: "codex",
  configFormat: "toml",
  mcpConfigPath: (home) => join(homeRoot(home), ".codex", "config.toml"),
  skillsDir: (home) => join(homeRoot(home), ".codex", "skills"),
};

/** @brief antigravity adapter: `~/.gemini/settings.json` + config skills. */
const ANTIGRAVITY_TARGET: CliTarget = {
  id: "antigravity",
  configFormat: "json",
  mcpConfigPath: (home) => join(homeRoot(home), ".gemini", "settings.json"),
  skillsDir: (home) => join(homeRoot(home), ".gemini", "config", "skills"),
};

/** @brief claude adapter: `~/.claude.json` + `~/.claude/skills`. */
const CLAUDE_TARGET: CliTarget = {
  id: "claude",
  configFormat: "json",
  mcpConfigPath: (home) => join(homeRoot(home), ".claude.json"),
  skillsDir: (home) => join(homeRoot(home), ".claude", "skills"),
};

/** @brief copilot adapter: `~/.copilot/mcp.json` + `~/.copilot/skills`. */
const COPILOT_TARGET: CliTarget = {
  id: "copilot",
  configFormat: "json",
  mcpConfigPath: (home) => join(homeRoot(home), ".copilot", "mcp.json"),
  skillsDir: (home) => join(homeRoot(home), ".copilot", "skills"),
};

/**
 * @brief Registry of supported CLI adapters keyed by canonical name.
 * @details Insertion order defines the `show` CLI Configuration table order
 * and the supported-name listing in diagnostics.
 * @satisfies REQ-110, REQ-117
 */
export const CLI_TARGETS: Record<CliTargetId, CliTarget> = {
  pi: PI_TARGET,
  openclaw: OPENCLAW_TARGET,
  codex: CODEX_TARGET,
  antigravity: ANTIGRAVITY_TARGET,
  claude: CLAUDE_TARGET,
  copilot: COPILOT_TARGET,
};

/**
 * @brief Resolve a CLI adapter by user-supplied name.
 * @details Trims surrounding whitespace and lowercases before the registry
 * lookup, matching `pi`, `openclaw`, `codex`, `antigravity`, `claude`,
 * `copilot` case-insensitively.
 * @param name {string} CLI name from the command line.
 * @return {CliTarget | undefined} Matching adapter; undefined when unsupported.
 * @satisfies REQ-110
 */
export function resolveCliTarget(name: string): CliTarget | undefined {
  return CLI_TARGETS[name.trim().toLowerCase() as CliTargetId];
}

/**
 * @brief Comma-separated list of supported CLI names for diagnostics.
 * @return {string} Ordered `pi, openclaw, codex, antigravity, claude, copilot`.
 * @satisfies REQ-110
 */
export function supportedCliNames(): string {
  return (Object.keys(CLI_TARGETS) as CliTargetId[]).join(", ");
}

/**
 * @brief Read and parse a JSON MCP configuration file.
 * @details Missing files yield `{}`; malformed JSON throws so the caller can
 * fail that CLI without ever overwriting the user's file.
 * @param configPath {string} Target configuration file path.
 * @return {Record<string, unknown>} Parsed JSON object.
 * @throws {Error} When the file exists but is not valid JSON.
 */
function readJsonConfig(configPath: string): Record<string, unknown> {
  if (!existsSync(configPath)) return {};
  const parsed: unknown = JSON.parse(readFileSync(configPath, "utf-8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`configuration is not a JSON object: ${configPath}`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * @brief Serialize and atomically write a JSON object to a file.
 * @details Two-space indentation, trailing newline, sibling `.tmp` write
 * followed by rename; parent directories are created on demand.
 * @param configPath {string} Target file path.
 * @param value {Record<string, unknown>} Object to serialize.
 * @return {void}
 * @throws {Error} When serialization, writing, or renaming fails.
 * @satisfies DES-019
 */
function writeJsonConfig(configPath: string, value: Record<string, unknown>): void {
  const temporary = `${configPath}.tmp`;
  mkdirSync(join(configPath, ".."), { recursive: true });
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", "utf-8");
  renameSync(temporary, configPath);
}

/**
 * @brief Register an MCP-server entry in a JSON `mcpServers` configuration.
 * @details Read-modify-write: parses the file (missing files start as `{}`),
 * upserts `mcpServers.<serverName>` leaving every unrelated key untouched,
 * and replaces the file atomically.
 * @param configPath {string} JSON configuration file path.
 * @param serverName {string} Server key inside `mcpServers`.
 * @param entry {McpServerRegistration} Registration entry to upsert.
 * @return {void}
 * @throws {Error} When the existing file is malformed or the write fails.
 * @satisfies DES-019, REQ-112
 */
export function writeJsonMcpServerEntry(
  configPath: string,
  serverName: string,
  entry: McpServerRegistration
): void {
  const config = readJsonConfig(configPath);
  const mcpServers = (config.mcpServers ?? {}) as Record<string, unknown>;
  if (mcpServers === null || typeof mcpServers !== "object" || Array.isArray(mcpServers)) {
    throw new Error(`mcpServers is not an object: ${configPath}`);
  }
  mcpServers[serverName] = entry;
  config.mcpServers = mcpServers;
  writeJsonConfig(configPath, config);
}

/**
 * @brief Remove an MCP-server entry from a JSON `mcpServers` configuration.
 * @details Deletes `mcpServers.<serverName>` when present and rewrites the
 * file atomically; an empty `mcpServers` object is kept to minimize
 * disruption. Missing files are a successful no-op.
 * @param configPath {string} JSON configuration file path.
 * @param serverName {string} Server key inside `mcpServers`.
 * @return {boolean} True when an entry was removed; false when absent.
 * @throws {Error} When the existing file is malformed or the write fails.
 * @satisfies DES-019, REQ-115
 */
export function removeJsonMcpServerEntry(configPath: string, serverName: string): boolean {
  if (!existsSync(configPath)) return false;
  const config = readJsonConfig(configPath);
  const mcpServers = config.mcpServers;
  if (mcpServers === undefined) return false;
  if (mcpServers === null || typeof mcpServers !== "object" || Array.isArray(mcpServers)) {
    throw new Error(`mcpServers is not an object: ${configPath}`);
  }
  const map = mcpServers as Record<string, unknown>;
  if (!(serverName in map)) return false;
  delete map[serverName];
  config.mcpServers = map;
  writeJsonConfig(configPath, config);
  return true;
}

/**
 * @brief Read one MCP-server entry from a JSON configuration.
 * @param configPath {string} JSON configuration file path.
 * @param serverName {string} Server key inside `mcpServers`.
 * @return {McpServerRegistration | undefined} Entry when registered; undefined otherwise.
 */
export function readJsonMcpServerEntry(
  configPath: string,
  serverName: string
): McpServerRegistration | undefined {
  try {
    const config = readJsonConfig(configPath);
    const mcpServers = config.mcpServers;
    if (mcpServers === null || typeof mcpServers !== "object" || Array.isArray(mcpServers)) {
      return undefined;
    }
    return (mcpServers as Record<string, McpServerRegistration>)[serverName];
  } catch {
    return undefined;
  }
}

/**
 * @brief Escape a value as a TOML basic string.
 * @details Escapes backslash and double-quote characters.
 * @param value {string} Raw string value.
 * @return {string} Quoted TOML basic string.
 */
function tomlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * @brief Header line of one managed server's TOML table.
 * @param serverName {string} Server key inside `mcp_servers`.
 * @return {string} Exact `[mcp_servers.<serverName>]` header line.
 */
function tomlSectionHeader(serverName: string): string {
  return `[mcp_servers.${serverName}]`;
}

/**
 * @brief Remove one managed server's TOML table from raw content.
 * @details Deletes the `[mcp_servers.<name>]` header line plus its body up to
 * the next top-level `[` table header or EOF, collapsing the resulting
 * duplicate blank separators. Other tables are preserved byte-for-byte.
 * @param content {string} Raw TOML document content.
 * @param serverName {string} Server key inside `mcp_servers`.
 * @return {string} Content with the managed table removed.
 */
function removeTomlSection(content: string, serverName: string): string {
  const lines = content.split("\n");
  const header = tomlSectionHeader(serverName);
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (skipping) {
      if (line.trimStart().startsWith("[")) {
        skipping = false;
      } else {
        continue;
      }
    } else if (line.trim() === header) {
      skipping = true;
      while (kept.length > 0 && kept[kept.length - 1].trim() === "") {
        kept.pop();
      }
      continue;
    }
    kept.push(line);
  }
  while (kept.length > 0 && kept[kept.length - 1].trim() === "") {
    kept.pop();
  }
  return kept.length > 0 ? kept.join("\n") + "\n" : "";
}

/**
 * @brief Detect one managed server's TOML table in raw content.
 * @param content {string} Raw TOML document content.
 * @param serverName {string} Server key inside `mcp_servers`.
 * @return {boolean} True when the `[mcp_servers.<name>]` header line exists.
 */
function hasTomlSection(content: string, serverName: string): boolean {
  return content.split("\n").some((line) => line.trim() === tomlSectionHeader(serverName));
}

/**
 * @brief Serialize a registration entry as TOML table lines.
 * @param entry {McpServerRegistration} Registration entry.
 * @return {string[]} `command`, optional `args`, and optional `env` lines.
 */
function registrationToTomlLines(entry: McpServerRegistration): string[] {
  const lines = [`command = ${tomlString(entry.command)}`];
  if (entry.args !== undefined) {
    lines.push(`args = [${entry.args.map((arg) => tomlString(arg)).join(", ")}]`);
  }
  if (entry.env !== undefined) {
    const pairs = Object.entries(entry.env).map(([key, value]) => `${tomlString(key)} = ${tomlString(value)}`);
    if (pairs.length > 0) lines.push(`env = { ${pairs.join(", ")} }`);
  }
  return lines;
}

/**
 * @brief Register an MCP-server table in a TOML configuration file.
 * @details Reads the file (missing files start empty), removes any existing
 * managed table, then appends the fresh `[mcp_servers.<name>]` table. Other
 * tables are preserved; the write is atomic via sibling `.tmp` + rename.
 * @param configPath {string} TOML configuration file path.
 * @param serverName {string} Server key inside `mcp_servers`.
 * @param entry {McpServerRegistration} Registration entry to write.
 * @return {void}
 * @throws {Error} When reading or writing fails.
 * @satisfies DES-019, REQ-112
 */
export function writeTomlMcpServerSection(
  configPath: string,
  serverName: string,
  entry: McpServerRegistration
): void {
  const previous = existsSync(configPath) ? readFileSync(configPath, "utf-8") : "";
  const base = removeTomlSection(previous, serverName);
  const table = [tomlSectionHeader(serverName), ...registrationToTomlLines(entry), ""].join("\n");
  const content = base.length > 0 ? base.replace(/\n*$/, "\n") + table : table;
  const temporary = `${configPath}.tmp`;
  mkdirSync(join(configPath, ".."), { recursive: true });
  writeFileSync(temporary, content, "utf-8");
  renameSync(temporary, configPath);
}

/**
 * @brief Remove an MCP-server table from a TOML configuration file.
 * @details Missing files and absent tables are successful no-ops; otherwise
 * the managed table is removed and the file is rewritten atomically.
 * @param configPath {string} TOML configuration file path.
 * @param serverName {string} Server key inside `mcp_servers`.
 * @return {boolean} True when a table was removed; false when absent.
 * @throws {Error} When reading or writing fails.
 * @satisfies DES-019, REQ-115
 */
export function removeTomlMcpServerSection(configPath: string, serverName: string): boolean {
  if (!existsSync(configPath)) return false;
  const previous = readFileSync(configPath, "utf-8");
  if (!hasTomlSection(previous, serverName)) return false;
  const content = removeTomlSection(previous, serverName);
  const temporary = `${configPath}.tmp`;
  writeFileSync(temporary, content, "utf-8");
  renameSync(temporary, configPath);
  return true;
}

/**
 * @brief Detect one managed server's TOML table in a configuration file.
 * @param configPath {string} TOML configuration file path.
 * @param serverName {string} Server key inside `mcp_servers`.
 * @return {boolean} True when the managed table header exists.
 */
export function hasTomlMcpServerSection(configPath: string, serverName: string): boolean {
  if (!existsSync(configPath)) return false;
  return hasTomlSection(readFileSync(configPath, "utf-8"), serverName);
}

/**
 * @brief Recursively list relative file paths under a directory.
 * @param root {string} Directory to scan.
 * @return {string[]} POSIX-style relative file paths; empty when the directory is absent.
 */
function listFilesRecursive(root: string): string[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else {
        files.push(relative(root, full).split("\\").join("/"));
      }
    }
  };
  walk(root);
  return files;
}

/**
 * @brief Relative POSIX name of the skill document that receives the debug overlay.
 * @details Install appends the overlay after this file so the skill hosts a
 * single operative document.
 */
const SKILL_DOCUMENT_FILE = "SKILL.md";

/**
 * @brief Skill content layout consumed by install synchronization and status comparison.
 * @details `debugPath` names the packaged debug overlay file relative to the
 * skill directory and is excluded from the synchronized tree in every mode
 * (REQ-155). `includeDebug` appends the overlay content to the installed
 * `SKILL.md` (REQ-156); the packaged document is always rewritten first, so
 * repeated runs never duplicate the overlay (REQ-157). Status comparison
 * accepts both the plain and the overlay-extended document (REQ-158).
 * @satisfies REQ-155, REQ-156, REQ-157, REQ-158
 */
export interface SkillContentLayout {
  debugPath?: string;
  includeDebug?: boolean;
}

/**
 * @brief Synchronize one packaged skill directory into a destination.
 * @details Creates the destination, recursively copies every packaged content
 * file with overwrite while excluding any declared debug overlay, then deletes
 * destination files and directories absent from the package — strictly inside
 * the managed skill directory, so sibling unmanaged skills are never touched.
 * Pruning runs deepest-first. When `layout.includeDebug` is true the overlay
 * content is appended to the installed `SKILL.md` after the fresh copy.
 * @param source {string} Packaged skill directory containing `SKILL.md`.
 * @param destination {string} Target `<skillsDir>/<skill-id>` path.
 * @param layout {SkillContentLayout} Debug overlay declaration; defaults to no overlay.
 * @return {void}
 * @throws {Error} When copying, appending, or pruning fails.
 * @pre `source` MUST exist.
 * @post `destination` mirrors exactly the packaged content tree plus the optional debug overlay.
 * @satisfies DES-020, REQ-155, REQ-156, REQ-157
 */
export function syncSkillTree(source: string, destination: string, layout: SkillContentLayout = {}): void {
  mkdirSync(destination, { recursive: true });
  cpSync(source, destination, {
    recursive: true,
    force: true,
    filter: (entry) =>
      layout.debugPath === undefined || relative(source, entry).split("\\").join("/") !== layout.debugPath,
  });
  const expected = new Set(listFilesRecursive(source).filter((rel) => rel !== layout.debugPath));
  const existing = listFilesRecursive(destination);
  existing.sort((a, b) => b.length - a.length);
  for (const rel of existing) {
    if (expected.has(rel)) continue;
    rmSync(join(destination, rel), { recursive: true, force: true });
  }
  if (layout.includeDebug === true && layout.debugPath !== undefined) {
    appendFileSync(
      join(destination, ...SKILL_DOCUMENT_FILE.split("/")),
      readFileSync(join(source, ...layout.debugPath.split("/")))
    );
  }
}

/**
 * @brief Remove one managed skill directory from a skills destination.
 * @details Missing directories are successful no-ops; nothing outside the
 * named directory is touched and no directory is created.
 * @param skillDir {string} Managed `<skillsDir>/<skill-id>` path.
 * @return {void}
 * @throws {Error} When recursive deletion fails.
 * @satisfies DES-020, REQ-115
 */
export function removeSkillDir(skillDir: string): void {
  rmSync(skillDir, { recursive: true, force: true });
}

/**
 * @brief Compare one packaged skill directory with its installed copy.
 * @details Every packaged content file must exist in the destination with
 * identical bytes; the declared debug overlay is ignored as a standalone file
 * and the installed `SKILL.md` counts as matching when it equals either the
 * packaged document or the packaged document plus the overlay content
 * (REQ-158). Extra destination files are ignored (staleness is judged only on
 * packaged content).
 * @param source {string} Packaged skill directory.
 * @param destination {string} Installed skill directory.
 * @param layout {SkillContentLayout} Debug overlay declaration; defaults to no overlay.
 * @return {string} `OK` when all packaged content matches, `MISSING` when the
 * package or destination is absent, `STALE` on byte mismatch.
 * @satisfies REQ-118, REQ-158
 */
export function compareSkillTree(
  source: string,
  destination: string,
  layout: SkillContentLayout = {}
): "OK" | "MISSING" | "STALE" {
  const packaged = listFilesRecursive(source).filter((rel) => rel !== layout.debugPath);
  if (packaged.length === 0) return "MISSING";
  if (!existsSync(destination)) return "MISSING";
  for (const rel of packaged) {
    const target = join(destination, ...rel.split("/"));
    if (!existsSync(target)) return "MISSING";
    const packagedText = readFileSync(join(source, ...rel.split("/"))).toString("utf-8");
    const installedText = readFileSync(target).toString("utf-8");
    if (installedText === packagedText) continue;
    if (rel === SKILL_DOCUMENT_FILE && layout.debugPath !== undefined) {
      const overlayText = readFileSync(join(source, ...layout.debugPath.split("/"))).toString("utf-8");
      if (installedText === packagedText + overlayText) continue;
    }
    return "STALE";
  }
  return "OK";
}

/**
 * @brief Detect whether a CLI has the managed server entry registered.
 * @param target {CliTarget} CLI adapter.
 * @param serverName {string} Managed server key.
 * @param home {string | undefined} Home-directory override.
 * @return {boolean} True when the entry/table is present and parseable.
 */
export function isServerRegistered(target: CliTarget, serverName: string, home?: string): boolean {
  const configPath = target.mcpConfigPath(home);
  if (target.configFormat === "toml") {
    return hasTomlMcpServerSection(configPath, serverName);
  }
  return readJsonMcpServerEntry(configPath, serverName) !== undefined;
}

/**
 * @brief Write or remove the managed server entry for one CLI target.
 * @param target {CliTarget} CLI adapter.
 * @param serverName {string} Managed server key.
 * @param entry {McpServerRegistration | undefined} Entry to register;
 * undefined removes the entry.
 * @param home {string | undefined} Home-directory override.
 * @return {void}
 * @throws {Error} When the configuration read-modify-write fails.
 * @satisfies DES-019, REQ-112, REQ-115
 */
export function applyServerRegistration(
  target: CliTarget,
  serverName: string,
  entry: McpServerRegistration | undefined,
  home?: string
): void {
  const configPath = target.mcpConfigPath(home);
  if (target.configFormat === "toml") {
    if (entry === undefined) {
      removeTomlMcpServerSection(configPath, serverName);
    } else {
      writeTomlMcpServerSection(configPath, serverName, entry);
    }
    return;
  }
  if (entry === undefined) {
    removeJsonMcpServerEntry(configPath, serverName);
  } else {
    writeJsonMcpServerEntry(configPath, serverName, entry);
  }
}
